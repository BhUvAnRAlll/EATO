// Turns a Clerk error into one friendly line for the UI.
type ClerkErrorLike = {
  message: string;
  longMessage?: string;
  errors?: { message: string; longMessage?: string }[];
};

export function getClerkErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Something went wrong. Please try again.";
  const clerkError = error as ClerkErrorLike;
  const first = clerkError.errors?.[0];
  return first?.longMessage ?? first?.message ?? clerkError.longMessage ?? clerkError.message;
}
