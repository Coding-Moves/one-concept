export const minimumPasswordLength = 12;

export function passwordInputError(password: string, confirmation: string): string {
  if (password.length < minimumPasswordLength)
    return `Use at least ${minimumPasswordLength} characters for your new password.`;
  if (password !== confirmation) return "The passwords do not match.";
  return "";
}

export function passwordUpdateError(error: { code?: string; message?: string }): string {
  if (error.code === "weak_password")
    return error.message && error.message !== "Weak password"
      ? `Password not accepted: ${error.message}`
      : "Choose a stronger password. Use at least 12 characters and follow any additional requirements shown by Supabase.";
  if (error.code === "same_password") return "Choose a password different from your current one.";
  if (error.code === "reauthentication_needed")
    return "Your reset session needs to be verified again. Request a new password link.";
  if (error.code === "insufficient_aal")
    return "This account has an enrolled authenticator. Enter its current six-digit code to finish changing the password.";
  return "Password could not be saved. Check your connection or request a new reset link.";
}
