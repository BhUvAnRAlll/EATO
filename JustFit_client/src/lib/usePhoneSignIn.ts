import { useEffect, useRef, useState } from "react";

import { requestCode, verifyCode } from "@/lib/account";
import { goAfterSignIn } from "@/lib/auth";
import { normalizeIndianMobile, phoneInput } from "@/lib/phone";
import { secondsLeft } from "@/lib/sessionRules";
import { useAuthStore } from "@/store/auth";
import { track } from "@/lib/analytics";

const INVALID_PHONE = "Enter a valid 10-digit mobile number.";

// Phone sign-in for the Log in and Sign up screens (one flow: a number that has no account yet
// gets a new member account when its code is verified). The resend countdown starts from the
// server's own answer and is only a guide: the server enforces every limit itself.
export function usePhoneSignIn() {
  const [phone, setPhoneText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  // The number the open code sheet is for (the field can change behind it)
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  // Ticks once a second while a countdown runs
  useEffect(() => {
    if (resendUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendUntil]);

  const holdResend = (seconds: number | undefined) => {
    if (seconds) setResendUntil(Date.now() + seconds * 1000);
    setNow(Date.now());
  };

  const setPhone = (text: string) => {
    setPhoneText(phoneInput(text));
    setError(null);
  };

  // Asks the server to text a code to `digits`. Returns an error line, or null once sent.
  const send = async (digits: string): Promise<string | null> => {
    const result = await requestCode(digits);
    if (result.ok) {
      holdResend(result.data.retryAfterSeconds);
      return null;
    }
    holdResend(result.retryAfterSeconds);
    return result.error;
  };

  // "Send code": checks the number here first (the server checks again), then opens the code sheet
  const sendCode = async () => {
    if (busy.current) return;
    const digits = normalizeIndianMobile(phone);
    if (!digits) return setError(INVALID_PHONE);
    // A code for this number was sent a moment ago and the sheet was closed: reopen it
    if (digits === sentTo && secondsLeft(resendUntil, Date.now()) > 0) {
      setCodeOpen(true);
      return;
    }
    busy.current = true;
    setSending(true);
    setError(null);
    const failure = await send(digits);
    setSending(false);
    busy.current = false;
    if (failure) return setError(failure);
    setSentTo(digits);
    setCodeOpen(true);
  };

  // The code sheet's six digits. Returns an error line for the sheet, or null when signed in.
  const verify = async (code: string): Promise<string | null> => {
    if (!sentTo) return "Please ask for a new code.";
    const result = await verifyCode(sentTo, code);
    if (!result.ok) return result.error;
    await useAuthStore.getState().signedIn(result.data.token, result.data.user);
    track("login_completed", { newAccount: result.data.user.isNew });
    setCodeOpen(false);
    goAfterSignIn();
    return null;
  };

  // "Resend" in the code sheet: only once the countdown is over
  const resend = async (): Promise<string | null> => {
    if (!sentTo || busy.current || secondsLeft(resendUntil, Date.now()) > 0) return null;
    busy.current = true;
    const failure = await send(sentTo);
    busy.current = false;
    return failure;
  };

  return {
    phone,
    setPhone,
    error,
    sending,
    codeOpen,
    closeCode: () => setCodeOpen(false),
    sentTo,
    sendCode,
    verify,
    resend,
    resendIn: secondsLeft(resendUntil, now),
  };
}
