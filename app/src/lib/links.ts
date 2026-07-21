// Invite deep links. Two shapes reach the app:
//   https://cartpool.app/i/{code}   (universal/app link, what invites contain)
//   cartpool://i/{code}             (custom scheme; works before the domain
//                                    association files are live)
//
// Parsing is deliberately strict — 8 chars of the create_invite alphabet
// (base32 minus 0/O/1/I) — so a malformed or hostile URL yields null rather
// than junk in the code field.
export const INVITE_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export function parseInviteUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/^(?:https:\/\/cartpool\.app|cartpool:\/)\/i\/([^/?#]+)/i);
  if (!m) return null;
  const code = m[1].toUpperCase();
  return INVITE_CODE_RE.test(code) ? code : null;
}
