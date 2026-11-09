import type { ReactNode } from "react";

import { ScreenHeader } from "@/components/ScreenHeader";

type MacroHeaderProps = { title: string; subtitle?: string; right?: ReactNode };

// The header of every pushed Macro screen: the shared ScreenHeader, with Back falling back to the
// Macro tab when the screen was opened from a link
export function MacroHeader({ title, subtitle, right }: MacroHeaderProps) {
  return <ScreenHeader title={title} subtitle={subtitle} right={right} fallback="/macro" />;
}
