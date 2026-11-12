// Keys pasted into a hosting dashboard often carry a trailing newline or space. In PAYPAL_CLIENT_ID
// that breaks the PayPal button's script URL (the resident page fails to render), and in other values
// it breaks auth headers and payout emails. Trim every value once, before anything reads them.
export function trimEnv() {
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== v.trim()) process.env[k] = v.trim();
}
