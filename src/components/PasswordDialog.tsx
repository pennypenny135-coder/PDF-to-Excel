"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

interface Props {
  fileName: string;
  incorrect: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/** 密碼只存在於此元件狀態與 PDF.js 呼叫中，不寫入 log 或儲存空間。 */
export default function PasswordDialog({ fileName, incorrect, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = password;
    setPassword("");
    onSubmit(p);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwd-title"
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id="pwd-title" className="text-lg font-semibold">
          此 PDF 需要密碼
        </h2>
        <p className="mt-2 break-all text-sm text-slate-600">檔案：{fileName}</p>
        {incorrect && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-700">
            密碼不正確，請重新輸入。
          </p>
        )}
        <label htmlFor="pdf-password" className="mt-4 block text-sm font-medium">
          開啟密碼
        </label>
        <input
          id="pdf-password"
          ref={inputRef}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
        <p className="mt-2 text-xs text-slate-500">密碼只保留在瀏覽器記憶體中，用於解開此文件，不會被儲存或上傳。</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            取消
          </button>
          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            開啟
          </button>
        </div>
      </form>
    </div>
  );
}
