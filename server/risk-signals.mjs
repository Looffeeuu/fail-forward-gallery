// Rule-based danger signals. A match never rejects, hides, or rewrites
// anything: it only moves the item to the top of the human review queue and
// shows the writer caring support information straight away. Expect false
// positives ("累得想死") — reviewers decide. The team should review this list
// with a mental-health professional before the pilot.
const SIGNALS = Object.freeze([
  {
    code: 'self-harm',
    patterns: [
      /想死|不想活|活不下去|活着没意思|活着没有意义|自杀|轻生|结束(自己的)?生命|了结自己/,
      /割腕|跳楼|跳河|上吊|烧炭|安眠药|吃药自杀|自残|自伤|伤害自己|遗书|告别这个世界/,
      /\b(suicid(e|al)|kill(ing)? myself|end(ing)? my life|want(ed)? to die|self[- ]?harm)\b/i,
      /\b(cut(ting)? myself|hurt(ing)? myself|no reason to live|better off dead|overdos(e|ing))\b/i
    ]
  },
  {
    code: 'harm-to-others',
    patterns: [
      /杀了(他|她|他们|她们)|报复社会|同归于尽|弄死(他|她)/,
      /\b(kill (him|her|them)|hurt (him|her|them)|make them pay)\b/i
    ]
  }
]);

export function detectRiskSignals(...texts) {
  const text = texts.filter(Boolean).join('\n');
  return SIGNALS
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)))
    .map(({ code }) => code);
}
