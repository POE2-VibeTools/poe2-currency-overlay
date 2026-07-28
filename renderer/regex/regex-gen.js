// Regex generation core for the Regex tab (classic script, no deps).
// Turns picked mods + thresholds into the compact patterns players paste into
// the in-game search box: numeric ">= N" classes, shortest-unique fragments
// against the item class's mod pool, ! exclusion groups, quoted terms.
(() => {
  'use strict';

  const ESC_RE = /[.*+?^${}()|[\]\\\/]/g;
  const esc = (s) => String(s).replace(ESC_RE, '\\$&');

  // ---- ">= n" numeric pattern -----------------------------------------------
  // Builds the k-digit alternation (classic digit-position decomposition, with
  // the trailing-zero merge so 50 -> [5-9][0-9], not (5[0-9]|[6-9][0-9])), plus
  // a "more digits" term so +150 still matches a ">= 50" search - the naive
  // hand-written [5-9][0-9] silently misses 3-digit rolls.
  // max: highest value the mod can roll (omit the more-digits term when it
  // can't occur). Uses explicit [0-9], never \d - matches what players share.
  function gteRegex(n, max) {
    n = Math.max(0, Math.floor(n));
    const d = String(n).split('').map(Number);
    const k = d.length;
    // terms[i]: exact prefix d0..d(i-1), digit at i in [lo..9], any digits after
    const terms = [];
    for (let i = k - 1; i >= 0; i--) {
      const lo = i === k - 1 ? d[i] : d[i] + 1;
      if (lo > 9) continue;
      terms.push({ prefix: d.slice(0, i).join(''), lo, wild: k - 1 - i });
    }
    // merge cascade: a term whose range is the full [0..9] is swallowed by
    // widening the next-shorter-prefix term's range down by one
    for (let i = 0; i < terms.length - 1; i++) {
      const t = terms[i], nx = terms[i + 1];
      if (t.lo === 0 && nx.wild === t.wild + 1 && nx.lo - 1 >= 0 &&
          nx.prefix === t.prefix.slice(0, -1) && Number(t.prefix.slice(-1)) === nx.lo - 1) {
        nx.lo -= 1;
        terms[i] = null;
      }
    }
    const cls = (lo) => lo === 9 ? '9' : lo === 0 ? '[0-9]' : `[${lo}-9]`;
    const out = terms.filter(Boolean)
      .map((t) => t.prefix + cls(t.lo) + '[0-9]'.repeat(t.wild));
    // values with more digits than n always qualify
    if (max == null || max >= Math.pow(10, k)) out.push('[1-9]' + '[0-9]'.repeat(k - 1) + '[0-9]+');
    return out.length === 1 ? out[0] : `(${out.join('|')})`;
  }

  // ---- shortest unique fragment ---------------------------------------------
  // Pool entries are mod texts with # for numbers. Returns a paste-ready
  // PATTERN (escaped) matching this mod's line and no other line in the pool.
  // Prefers word-start fragments (readable) over mid-word ones of the same
  // length. When a mod's text is a strict substring of a sibling's (Temple's
  // "# extra packs..." vs "#% chance for an extra packs..."), no literal
  // fragment can separate them - the digit position itself is the context, so
  // the fallback emits "[0-9] <head>" / "<tail> [0-9]" digit-adjacent forms.
  const norm = (s) => String(s).toLowerCase();

  function uniqueFragment(text, pool) {
    const t = norm(text);
    // superlines - lines CONTAINING this whole mod text (the generic
    // "Monsters have #% increased Effectiveness" inside Abyss's "Abyssal
    // Monsters have ... for each closed Pit") - are exempt: no substring of
    // the shorter line can exclude them, and they display the same stat, so
    // matching both is the correct gameplay outcome.
    const others = pool.map(norm).filter((p) => p !== t && !p.includes(t));
    // candidate windows come from the literal text only - never across a #
    const spans = t.split('#').map((s) => s.trim()).filter((s) => s.length >= 3);
    // a candidate may not end on a word-final 's': the game singularizes count
    // words at value 1 ("1 additional random Modifier"), so a plural-anchored
    // fragment would miss those lines
    const pluralEnd = (span, i, len) => span[i + len - 1] === 's' && (i + len === span.length || span[i + len] === ' ');
    for (let len = 3; len <= 24; len++) {
      const cands = [];
      for (const span of spans) {
        for (let i = 0; i + len <= span.length; i++) {
          const frag = span.slice(i, i + len);
          if (frag.startsWith(' ') || frag.endsWith(' ')) continue;
          if (pluralEnd(span, i, len)) continue;
          if (others.some((o) => o.includes(frag))) continue;
          cands.push({ frag, wordStart: i === 0 || span[i - 1] === ' ' });
        }
      }
      if (cands.length) return esc((cands.find((c) => c.wordStart) || cands[0]).frag);
    }
    // no literal fragment is unique - use the number's position as context.
    // "# head..." lines: '[0-9] head' collides only if another line also has
    // that head right after ITS number, i.e. contains '# ' + head.
    const parts = t.split('#');
    for (let len = 3; len <= 40; len++) {
      for (let pi = 1; pi < parts.length; pi++) {
        const head = parts[pi].replace(/^[%\s]*/, '');
        const sep = parts[pi].slice(0, parts[pi].length - head.length); // "% " / " "
        if (head.length < len) continue;
        const frag = head.slice(0, len);
        if (frag.endsWith(' ')) continue;
        if (!others.some((o) => o.includes('#' + sep + frag))) return '[0-9]' + esc(sep) + esc(frag);
      }
      for (let pi = 0; pi < parts.length - 1; pi++) {
        const tail = parts[pi].replace(/[\s+]*$/, '');
        const sep = parts[pi].slice(tail.length); // " +" / " "
        if (tail.length < len) continue;
        const frag = tail.slice(-len);
        if (frag.startsWith(' ')) continue;
        if (!others.some((o) => o.includes(frag + sep + '#'))) return esc(frag) + esc(sep) + '[0-9]';
      }
    }
    // still nothing: use the full anchored construction with "any number" in
    // the value slot - same machinery as thresholds, so a line whose only
    // distinguisher is pre+post around its number still resolves
    if (t.includes('#')) return anchoredPattern(t, '[0-9]+', others);
    // truly pathological: longest literal span, escaped, verbatim
    return esc((spans.sort((a, b) => b.length - a.length)[0] || t).slice(0, 40));
  }

  // ---- anchored pattern: <pre-anchor><g><post-disambig> ---------------------
  // Shared by thresholds (g = gteRegex) and last-resort fragments (g = [0-9]+).
  // Invariant: an anchor is only safe if it never sits directly before a number
  // in any other pool line - pool lines have digits only at '#', so that is
  // exactly `other.includes(anchor + '#')`. When even the full pre collides,
  // extend PAST the number with the shortest post-prefix no collider shares.
  function anchoredPattern(t, g, othersRaw) {
    const hash = t.indexOf('#');
    const p = t.slice(0, hash);
    const postN = t.slice(hash + 1);

    if (p.trim()) {
      for (let len = Math.min(3, p.length); len <= p.length; len++) {
        const frag = p.slice(-len);
        if (frag.startsWith(' ')) continue;
        // every place this anchor precedes a number in ANOTHER line
        const collPosts = [];
        for (const o of othersRaw) {
          let i = 0;
          while ((i = o.indexOf(frag + '#', i)) >= 0) { collPosts.push(o.slice(i + frag.length + 1)); i++; }
        }
        if (!collPosts.length) return esc(frag) + g;
        if (len === p.length) {
          // full pre still ambiguous - disambiguate after the number (never
          // ending on a word-final 's': singular forms at value 1 must match)
          for (let pl = 1; pl <= postN.length; pl++) {
            const pf = postN.slice(0, pl);
            if (pf.endsWith('s') && (pl === postN.length || postN[pl] === ' ')) continue;
            if (!collPosts.some((cp) => cp.startsWith(pf))) return esc(frag) + g + esc(pf);
          }
          return esc(frag) + g + esc(postN);
        }
      }
      return esc(p) + g; // pre was all-spaces shorter than 3 - effectively number-first
    }

    // number-first ("#% increased ..."): g + shortest tail that never follows
    // a number anywhere else in the pool (word-final 's' skipped - see above)
    for (let len = 3; len <= postN.length; len++) {
      const frag = postN.slice(0, len);
      if (frag.endsWith(' ') && len < postN.length) continue;
      if (frag.endsWith('s') && (len === postN.length || postN[len] === ' ')) continue;
      if (!othersRaw.some((o) => o.includes('#' + frag))) return g + esc(frag);
    }
    return g + esc(postN);
  }

  // ---- per-mod pattern ------------------------------------------------------
  // mod: {text, max?, prop?}; min: threshold or null; pool: texts of the class.
  // A threshold pattern anchors the number: "<anchor>gte" for label-first lines,
  // "gte<tail>" for number-first lines. CRITICAL invariant: an anchor is only
  // safe if it never sits DIRECTLY BEFORE a number in any other pool line -
  // pool lines have digits only where their '#' is, so that is exactly the
  // check `other.includes(anchor + '#')`. When even the full pre-text collides
  // (the "Monsters deal #% ... Extra Fire/Cold/Lightning" family), the pattern
  // extends PAST the number with the shortest post-fragment no collider shares.
  function modPattern(mod, min, pool) {
    if (min == null || !mod.text.includes('#')) return uniqueFragment(mod.text, pool);
    const t = norm(mod.text);
    const othersRaw = pool.map(norm).filter((o) => o !== t && !o.includes(t)); // superlines exempt (see uniqueFragment)
    return anchoredPattern(t, gteRegex(min, mod.max), othersRaw);
  }

  // ---- assembly -------------------------------------------------------------
  // includes: [{mod, min, group?}] - ungrouped mods each become ONE space-
  // separated term (in-game search ANDs terms); mods sharing a group id merge
  // into a single OR term (their patterns joined with | - safe because every
  // member pattern parenthesizes its own internal alternations). excludes:
  // [mod] - one "!a|b|c" term (! negates the whole alternation). Terms
  // containing a space or | get quoted.
  function build(includes, excludes, pool) {
    const terms = [];
    const quoteIf = (p) => /[ |]/.test(p) ? `"${p}"` : p;
    const groups = new Map();
    for (const inc of includes) {
      if (inc.group == null) {
        terms.push(quoteIf(modPattern(inc.mod, inc.min, pool)));
      } else {
        if (!groups.has(inc.group)) groups.set(inc.group, []);
        groups.get(inc.group).push(inc);
      }
    }
    for (const members of groups.values()) {
      if (!members.length) continue;
      const alts = members.map((m) => modPattern(m.mod, m.min, pool)).join('|');
      terms.push(quoteIf(alts));
    }
    if (excludes.length) {
      const alts = excludes.map((m) => uniqueFragment(m.text, pool)).join('|');
      terms.push(`"!${alts}"`);
    }
    return terms.join(' ');
  }

  window.RegexGen = { gteRegex, uniqueFragment, modPattern, build };
})();
