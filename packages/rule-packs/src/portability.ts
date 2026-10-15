import { ALLOWED_GROUPS } from './schema';

/**
 * Constructs that behave differently (or do not exist) across JavaScript,
 * NSRegularExpression (ICU) and java.util.regex. See README "Portable regex subset".
 */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\(\?<[=!]/, 'lookbehind is not allowed'],
  [/\(\?[a-zA-Z-]+[:)]/, 'inline flags are not allowed'],
  [/\(\?>/, 'atomic groups are not allowed'],
  [/\(\?P/, 'Python-style named groups are not allowed'],
  [/\\k</, 'named backreferences are not allowed'],
  [/\\[1-9]/, 'backreferences are not allowed'],
  [/\\[pP]\{/, 'unicode property escapes are not allowed'],
  [/\\[dDwWbB]/, 'use explicit classes like [0-9] or [A-Za-z] instead of \\d, \\w, \\b'],
  [/\\[AZzGQEhHRXu]/, 'engine-specific escape is not allowed'],
  [/[*+?}]\+/, 'possessive quantifiers are not allowed'],
  [/&&/, 'character class intersection is not allowed'],
  [/\[\[:/, 'POSIX classes are not allowed'],
];

const allowed = new Set<string>(ALLOWED_GROUPS);

/** Returns a list of problems; empty means the pattern is in the portable subset. */
export function checkPortablePattern(pattern: string, opts: { requireAmount?: boolean } = {}) {
  const problems: string[] = [];
  for (const [re, message] of FORBIDDEN) {
    if (re.test(pattern)) problems.push(message);
  }
  const names = [...pattern.matchAll(/\(\?<([A-Za-z][A-Za-z0-9]*)>/g)].map((m) => m[1] ?? '');
  for (const name of names) {
    if (!allowed.has(name)) problems.push(`unknown group name: ${name}`);
  }
  if (new Set(names).size !== names.length) problems.push('duplicate group names');
  if (opts.requireAmount && !names.includes('amount')) problems.push('missing amount group');
  try {
    new RegExp(pattern, 'i');
  } catch (err) {
    problems.push(`does not compile: ${(err as Error).message}`);
  }
  return problems;
}
