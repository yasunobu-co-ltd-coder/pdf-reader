"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getVoiceSetting,
  saveVoiceSetting,
  getVoices,
} from "@/lib/api-client";

type Speaker = {
  name: string;
  styles: { name: string; id: number }[];
};

export default function SettingsPage() {
  const router = useRouter();
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [speakerId, setSpeakerId] = useState(1);
  const [speedScale, setSpeedScale] = useState(1.0);
  const [pitchScale, setPitchScale] = useState(0.0);
  const [intonationScale, setIntonationScale] = useState(1.0);
  const [volumeScale, setVolumeScale] = useState(1.0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [setting, voiceList] = await Promise.all([
          getVoiceSetting(),
          getVoices().catch(() => [] as Speaker[]),
        ]);

        if (setting) {
          setSpeakerId(setting.speaker_id);
          setSpeedScale(setting.speed_scale);
          setPitchScale(setting.pitch_scale);
          setIntonationScale(setting.intonation_scale);
          setVolumeScale(setting.volume_scale);
        }
        setSpeakers(voiceList);
      } catch {
        // 設定取得失敗はデフォルト値で続行
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await saveVoiceSetting({
        speaker_id: speakerId,
        speed_scale: speedScale,
        pitch_scale: pitchScale,
        intonation_scale: intonationScale,
        volume_scale: volumeScale,
      });
      setMessage("保存しました");
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "保存に失敗しました"
      );
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setSpeakerId(1);
    setSpeedScale(1.0);
    setPitchScale(0.0);
    setIntonationScale(1.0);
    setVolumeScale(1.0);
  }

  // 話者リストをフラットに
  const allStyles = speakers.flatMap((s) =>
    s.styles.map((st) => ({
      label: `${s.name} (${st.name})`,
      id: st.id,
    }))
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <button
          onClick={() => router.push("/documents")}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← 戻る
        </button>
        <h1 className="text-xl font-bold mt-1">音声設定</h1>
      </header>

      <main className="max-w-2xl mx-auto p-6">
        <div className="bg-white border rounded-lg p-6 space-y-6">
          {/* 話者選択 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              話者
            </label>
            {allStyles.length > 0 ? (
              <select
                value={speakerId}
                onChange={(e) => setSpeakerId(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                {allStyles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <div>
                <input
                  type="number"
                  value={speakerId}
                  onChange={(e) => setSpeakerId(parseInt(e.target.value) || 1)}
                  min={0}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
                <p className="text-xs text-gray-400 mt-1">
                  VOICEVOXサーバーに接続できない場合は話者IDを直接入力してください
                </p>
              </div>
            )}
          </div>

          {/* 話速 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              話速: {speedScale.toFixed(2)}x
            </label>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={speedScale}
              onChange={(e) => setSpeedScale(parseFloat(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>0.5x</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>

          {/* ピッチ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ピッチ: {pitchScale.toFixed(2)}
            </label>
            <input
              type="range"
              min={-0.15}
              max={0.15}
              step={0.01}
              value={pitchScale}
              onChange={(e) => setPitchScale(parseFloat(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>-0.15</span>
              <span>0.00</span>
              <span>0.15</span>
            </div>
          </div>

          {/* 抑揚 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              抑揚: {intonationScale.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.0}
              max={2.0}
              step={0.05}
              value={intonationScale}
              onChange={(e) =>
                setIntonationScale(parseFloat(e.target.value))
              }
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>0.0</span>
              <span>1.0</span>
              <span>2.0</span>
            </div>
          </div>

          {/* 音量 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              音量: {volumeScale.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.0}
              max={2.0}
              step={0.05}
              value={volumeScale}
              onChange={(e) => setVolumeScale(parseFloat(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>0.0</span>
              <span>1.0</span>
              <span>2.0</span>
            </div>
          </div>

          {message && (
            <div
              className={`p-3 rounded-md text-sm ${
                message.includes("失敗")
                  ? "bg-red-50 text-red-700"
                  : "bg-green-50 text-green-700"
              }`}
            >
              {message}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50 text-sm"
            >
              デフォルトに戻す
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
