"use client";

import { useState } from "react";

type WonInputProps = {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  name?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  required?: boolean;
};

function normalizeWon(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : 0;
}

export default function WonInput({
  value,
  defaultValue,
  onValueChange,
  name,
  className,
  ariaLabel,
  disabled,
  required,
}: WonInputProps) {
  const controlled = value !== undefined;
  const [draft, setDraft] = useState(() => normalizeWon(defaultValue));
  const [focused, setFocused] = useState(false);
  const amount = controlled ? normalizeWon(value) : draft;
  const display = focused ? (amount ? String(amount) : "") : `${amount.toLocaleString("ko-KR")}원`;

  return <>
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={className}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuenow={amount}
      disabled={disabled}
      required={required}
      value={display}
      onFocus={(event) => { const input = event.currentTarget; setFocused(true); requestAnimationFrame(() => input.select()); }}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        const digits = event.target.value.replace(/[^0-9]/g, "");
        const next = normalizeWon(digits ? Number(digits) : 0);
        if (!controlled) setDraft(next);
        onValueChange?.(next);
      }}
    />
    {name && <input type="hidden" name={name} value={amount} />}
  </>;
}
