import React, { useRef, useState, useImperativeHandle, forwardRef, useMemo } from 'react';
import { AlertTriangle, AlertCircle, Code2, ChevronDown, Plus } from 'lucide-react';
import type { MugenIssue } from '../lib/mugen/validator';

export interface MugenCodeEditorHandle {
  jumpToLine: (line: number) => void;
  jumpToHeader: (baseHeader: string, occurrence?: number) => void;
  insertAtCursor: (snippet: string) => void;
}

interface MugenCodeEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
  mode: 'Definitions' | 'Commands' | 'States';
  issues?: MugenIssue[];
  fileId?: string;
}

const SNIPPETS: { label: string; category: string; code: string }[] = [
  {
    label: '[Command] Quarter Circle Forward (QCF + Punch)',
    category: 'CMD',
    code: `\n[Command]\nname = "QCF_x"\ncommand = ~D, DF, F, x\ntime = 15\n`,
  },
  {
    label: '[Command] Dragon Punch (DP + Punch)',
    category: 'CMD',
    code: `\n[Command]\nname = "DP_x"\ncommand = ~F, D, DF, x\ntime = 18\n`,
  },
  {
    label: '[Command] Charge Back-Forward',
    category: 'CMD',
    code: `\n[Command]\nname = "Charge_BF"\ncommand = ~30$B, F, x\ntime = 15\n`,
  },
  {
    label: '[Statedef] Attack State Template',
    category: 'CNS',
    code: `\n;---------------------------------------------------------------------------\n; Custom Attack State\n[Statedef 200]\ntype     = S\nmovetype = A\nphysics  = S\njuggletime = 1\nvelset   = 0,0\nctrl     = 0\nanim     = 200\nsprpriority = 2\n\n[State 200, End]\ntype = ChangeState\ntrigger1 = AnimTime = 0\nvalue = 0\nctrl = 1\n`,
  },
  {
    label: '[State] HitDef (Melee Strike)',
    category: 'CNS',
    code: `\n[State , HitDef]\ntype = HitDef\ntrigger1 = AnimElem = 2\nattr = S, NA\ndamage = 35, 0\nanimtype = Light\nguardflag = MA\nhitflag = MAF\npausetime = 8, 8\nsparkno = 0\nground.type = High\nground.slidetime = 8\nground.hittime = 10\nground.velocity = -4\nair.velocity = -2.5, -3\n`,
  },
  {
    label: '[State] ChangeState',
    category: 'CNS',
    code: `\n[State , ChangeState]\ntype = ChangeState\ntrigger1 = command = "x"\ntrigger1 = ctrl\nvalue = 200\n`,
  },
  {
    label: '[State] PlaySnd',
    category: 'CNS',
    code: `\n[State , PlaySnd]\ntype = PlaySnd\ntrigger1 = Time = 0\nvalue = 0, 0\nchannel = 0\n`,
  },
  {
    label: '[State] Explod (Visual FX)',
    category: 'CNS',
    code: `\n[State , Explod]\ntype = Explod\ntrigger1 = Time = 0\nanim = 7000\npos = 0, -40\npostype = p1\nsprpriority = 4\nownpal = 1\nremoveongethit = 1\n`,
  },
  {
    label: '[State] Helper (Projectile / Spawn)',
    category: 'CNS',
    code: `\n[State , Helper]\ntype = Helper\ntrigger1 = AnimElem = 3\nhelpertype = normal\nname = "Projectile"\nID = 1000\nstateno = 1005\npos = 40, -60\npostype = p1\nownpal = 1\n`,
  },
];

const MUGEN_KEYWORDS = new Set([
  'time', 'animtime', 'animelem', 'animelemno', 'animelemtime',
  'stateno', 'prevstateno', 'statetype', 'movetype', 'ctrl', 'alive',
  'command', 'pos', 'vel', 'p2bodydist', 'p2dist', 'frontedgebodydist',
  'backedgebodydist', 'movecontact', 'movehit', 'moveguarded', 'hitcount',
  'uniqhitcount', 'power', 'life', 'lifemax', 'var', 'fvar', 'sysvar',
  'roundstate', 'matchno', 'hitshakeover', 'hitover', 'numhelper', 'numexplod',
  'numtarget', 'ishelper', 'facing', 'palno', 'authorname', 'name', 'pi',
  'ifelse', 'cond', 'ceil', 'floor', 'abs', 'cos', 'sin', 'random', 'gametime'
]);

const CONTROLLER_TYPES = new Set([
  'changestate', 'selfstate', 'changeanim', 'changeanim2', 'hitdef', 'projectile',
  'playsnd', 'stopsnd', 'velset', 'veladd', 'velmul', 'posset', 'posadd',
  'ctrlset', 'statetypeset', 'explod', 'modifyexplod', 'removeexplod', 'helper',
  'destroyself', 'assertspecial', 'nothitby', 'hitby', 'palfx', 'allpalfx',
  'bgpalfx', 'envshake', 'afterimage', 'afterimagetime', 'varset', 'varadd',
  'parentvarset', 'poweradd', 'lifeadd', 'lifeset', 'targetbind', 'targetstate',
  'targetlifeadd', 'hitvelset', 'turn', 'width', 'sprpriority', 'angledraw',
  'angleset', 'angleadd', 'null', 'superpause', 'pause', 'bindtoparent'
]);

function renderExprTokens(expr: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const tokenRegex = /("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|([=!<>&|+\-*/~$,()[\]]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(expr)) !== null) {
    if (match.index > lastIndex) {
      parts.push(expr.slice(lastIndex, match.index));
    }
    const [full, strLit, numLit, ident, op] = match;
    if (strLit) {
      parts.push(<span key={`${keyPrefix}-${idx++}`} className="text-amber-300">{strLit}</span>);
    } else if (numLit) {
      parts.push(<span key={`${keyPrefix}-${idx++}`} className="text-purple-300">{numLit}</span>);
    } else if (ident) {
      const lower = ident.toLowerCase();
      if (CONTROLLER_TYPES.has(lower)) {
        parts.push(<span key={`${keyPrefix}-${idx++}`} className="text-emerald-400 font-semibold">{ident}</span>);
      } else if (MUGEN_KEYWORDS.has(lower)) {
        parts.push(<span key={`${keyPrefix}-${idx++}`} className="text-sky-300">{ident}</span>);
      } else {
        parts.push(<span key={`${keyPrefix}-${idx++}`} className="text-zinc-200">{ident}</span>);
      }
    } else if (op) {
      parts.push(<span key={`${keyPrefix}-${idx++}`} className="text-zinc-400">{op}</span>);
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < expr.length) {
    parts.push(expr.slice(lastIndex));
  }
  return parts;
}

function highlightMugenLine(line: string, lineIdx: number, isStateDefSection: { current: boolean }): React.ReactNode {
  if (!line) return '\u00A0';

  const semiIdx = line.indexOf(';');
  const codePart = semiIdx !== -1 ? line.slice(0, semiIdx) : line;
  const commentPart = semiIdx !== -1 ? line.slice(semiIdx) : '';

  const trimmedCode = codePart.trim();

  // Section Header
  if (trimmedCode.startsWith('[')) {
    const isClosed = trimmedCode.endsWith(']');
    const isStateDef = /^\[\s*statedef\b/i.test(trimmedCode);
    const isState = /^\[\s*state\b/i.test(trimmedCode);
    const isCommand = /^\[\s*command\s*\]$/i.test(trimmedCode);
    isStateDefSection.current = isStateDef;

    let cls = 'text-cyan-400 font-bold';
    if (!isClosed) cls = 'text-red-400 underline decoration-wavy font-bold';
    else if (isStateDef) cls = 'text-blue-400 font-bold';
    else if (isState) cls = 'text-teal-300 font-bold';
    else if (isCommand) cls = 'text-amber-400 font-bold';

    return (
      <>
        <span className={cls}>{codePart}</span>
        {commentPart && <span className="text-emerald-600/90 italic">{commentPart}</span>}
      </>
    );
  }

  // Key = Value
  const eqIdx = codePart.indexOf('=');
  if (eqIdx !== -1) {
    const rawKey = codePart.slice(0, eqIdx);
    const rawVal = codePart.slice(eqIdx + 1);
    const keyLower = rawKey.trim().toLowerCase();

    let keyCls = 'text-sky-400';
    if (keyLower.startsWith('trigger')) keyCls = 'text-pink-400 font-semibold';
    else if (keyLower === 'type') keyCls = 'text-emerald-300 font-semibold';
    else if (keyLower === 'value' || keyLower === 'anim' || keyLower === 'stateno') keyCls = 'text-indigo-300';

    return (
      <>
        <span className={keyCls}>{rawKey}</span>
        <span className="text-zinc-500">=</span>
        {renderExprTokens(rawVal, `l${lineIdx}`)}
        {commentPart && <span className="text-emerald-600/90 italic">{commentPart}</span>}
      </>
    );
  }

  return (
    <>
      {codePart && renderExprTokens(codePart, `l${lineIdx}`)}
      {commentPart && <span className="text-emerald-600/90 italic">{commentPart}</span>}
    </>
  );
}

export const MugenCodeEditor = forwardRef<MugenCodeEditorHandle, MugenCodeEditorProps>(
  ({ value, onChange, mode, issues = [], fileId }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const preRef = useRef<HTMLPreElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const [showSnippets, setShowSnippets] = useState(false);
    const [activeLine, setActiveLine] = useState<number>(1);

    const lines = useMemo(() => value.split('\n'), [value]);

    // Map line numbers -> issues for this file
    const lineIssueMap = useMemo(() => {
      const map = new Map<number, MugenIssue[]>();
      const sourceMatch = mode === 'Commands' ? 'CMD' : mode === 'States' ? 'CNS' : 'DEF';
      for (const issue of issues) {
        if (issue.source !== sourceMatch) continue;
        if (fileId && issue.fileId && issue.fileId !== fileId) continue;
        if (issue.line && issue.line > 0) {
          const existing = map.get(issue.line) || [];
          existing.push(issue);
          map.set(issue.line, existing);
        }
      }
      return map;
    }, [issues, mode, fileId]);

    const fileIssueCount = useMemo(() => {
      let count = 0;
      lineIssueMap.forEach(arr => { count += arr.length; });
      return count;
    }, [lineIssueMap]);

    const syncScroll = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      if (preRef.current) {
        preRef.current.scrollTop = ta.scrollTop;
        preRef.current.scrollLeft = ta.scrollLeft;
      }
      if (gutterRef.current) {
        gutterRef.current.scrollTop = ta.scrollTop;
      }
    };

    const updateActiveLineFromCursor = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      const before = ta.value.slice(0, ta.selectionStart || 0);
      setActiveLine(before.split('\n').length);
    };

    const scrollToLineInternal = (lineNum: number, selStart?: number, selEnd?: number) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const clampedLine = Math.max(1, Math.min(lines.length, lineNum));
      const lineHeight = 19.5; // matches leading-[19.5px] / text-[12px]
      const targetScroll = Math.max(0, (clampedLine - 4) * lineHeight);

      ta.focus();
      if (selStart !== undefined && selEnd !== undefined) {
        ta.setSelectionRange(selStart, selEnd);
      } else {
        let offset = 0;
        for (let i = 0; i < clampedLine - 1; i++) {
          offset += lines[i].length + 1;
        }
        const end = offset + (lines[clampedLine - 1]?.length || 0);
        ta.setSelectionRange(offset, end);
      }
      ta.scrollTop = targetScroll;
      setActiveLine(clampedLine);
      syncScroll();
    };

    useImperativeHandle(ref, () => ({
      jumpToLine: (line: number) => {
        scrollToLineInternal(line);
      },
      jumpToHeader: (baseHeader: string, occurrence: number = 1) => {
        const target = baseHeader.trim().toLowerCase();
        let seen = 0;
        let charOffset = 0;
        for (let idx = 0; idx < lines.length; idx++) {
          const rawLine = lines[idx];
          const semi = rawLine.indexOf(';');
          const code = (semi !== -1 ? rawLine.slice(0, semi) : rawLine).trim();
          const m = code.match(/^\[(.*)\]$/);
          if (m && m[1].trim().toLowerCase() === target) {
            seen++;
            if (seen === occurrence) {
              const openIdx = rawLine.indexOf('[');
              const closeIdx = rawLine.indexOf(']', openIdx !== -1 ? openIdx : 0);
              const sStart = charOffset + (openIdx !== -1 ? openIdx : 0);
              const sEnd = closeIdx !== -1 ? charOffset + closeIdx + 1 : sStart + baseHeader.length + 2;
              scrollToLineInternal(idx + 1, sStart, sEnd);
              return;
            }
          }
          charOffset += rawLine.length + 1;
        }
      },
      insertAtCursor: (snippet: string) => {
        const ta = textareaRef.current;
        if (!ta) {
          onChange(value + snippet);
          return;
        }
        const start = ta.selectionStart ?? value.length;
        const end = ta.selectionEnd ?? value.length;
        const nextVal = value.slice(0, start) + snippet + value.slice(end);
        onChange(nextVal);
        setTimeout(() => {
          ta.focus();
          const cursorPos = start + snippet.length;
          ta.setSelectionRange(cursorPos, cursorPos);
          updateActiveLineFromCursor();
          syncScroll();
        }, 0);
      },
    }), [lines, value, onChange]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const nextVal = value.slice(0, start) + '  ' + value.slice(end);
        onChange(nextVal);
        setTimeout(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        }, 0);
      }
    };

    const highlightedLines = useMemo(() => {
      const stateFlag = { current: false };
      return lines.map((line, i) => highlightMugenLine(line, i, stateFlag));
    }, [lines]);

    return (
      <div className="flex flex-col flex-1 min-h-0 bg-[#18181b] relative overflow-hidden">
        {/* Editor Mini Toolbar */}
        <div className="h-8 px-3 bg-[#141416] border-b border-[#2a2a2e] flex items-center justify-between text-[11px] shrink-0 select-none">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Code2 size={13} className="text-blue-400" />
              <span className="font-semibold text-zinc-300">{mode} Syntax</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">
              Ln {activeLine} / {lines.length}
            </span>
            {fileIssueCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-950/60 border border-red-800/60 text-red-300 font-medium">
                <AlertCircle size={11} />
                {fileIssueCount} issue{fileIssueCount > 1 ? 's' : ''} in file
              </span>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSnippets(s => !s)}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/35 border border-blue-500/40 text-blue-300 font-semibold text-[10px] transition-colors cursor-pointer"
            >
              <Plus size={11} />
              <span>Insert Snippet</span>
              <ChevronDown size={11} />
            </button>

            {showSnippets && (
              <div
                className="absolute right-0 top-full mt-1 w-72 bg-[#1f1f24] border border-[#3a3a42] rounded-lg shadow-2xl z-50 py-1 max-h-80 overflow-y-auto"
                onMouseLeave={() => setShowSnippets(false)}
              >
                <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 border-b border-[#2e2e36]">
                  M.U.G.E.N Templates
                </div>
                {SNIPPETS.map((snip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const ta = textareaRef.current;
                      if (ta) {
                        const start = ta.selectionStart ?? value.length;
                        const end = ta.selectionEnd ?? value.length;
                        const nextVal = value.slice(0, start) + snip.code + value.slice(end);
                        onChange(nextVal);
                        setTimeout(() => {
                          ta.focus();
                          ta.setSelectionRange(start + snip.code.length, start + snip.code.length);
                          syncScroll();
                        }, 0);
                      } else {
                        onChange(value + snip.code);
                      }
                      setShowSnippets(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-blue-600/25 flex items-center justify-between gap-2 text-[11px] text-zinc-200 transition-colors"
                  >
                    <span className="truncate">{snip.label}</span>
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                      {snip.category}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Synchronized Gutter + Highlighted Layer + Transparent Input Layer */}
        <div className="flex flex-1 min-h-0 relative overflow-hidden">
          {/* Line Number Gutter */}
          <div
            ref={gutterRef}
            onWheel={(e) => {
              const ta = textareaRef.current;
              if (!ta) return;
              ta.scrollTop += e.deltaY;
              syncScroll();
            }}
            className="w-12 bg-[#141416] border-r border-[#27272c] pt-3 pb-8 select-none overflow-hidden text-right font-mono text-[11px] leading-[19.5px] shrink-0"
          >
            {lines.map((_, i) => {
              const lineNum = i + 1;
              const lineIssues = lineIssueMap.get(lineNum);
              const hasErr = lineIssues?.some(is => is.severity === 'error');
              const hasWarn = !hasErr && lineIssues && lineIssues.length > 0;
              return (
                <div
                  key={lineNum}
                  title={lineIssues ? lineIssues.map(x => x.message).join('\n') : undefined}
                  className={`px-2 flex items-center justify-end gap-1 h-[19.5px] ${
                    hasErr
                      ? 'bg-red-950/60 text-red-400 font-bold'
                      : hasWarn
                        ? 'bg-amber-950/40 text-amber-400'
                        : activeLine === lineNum
                          ? 'bg-[#25252b] text-zinc-200 font-semibold'
                          : 'text-zinc-600'
                  }`}
                >
                  {hasErr && <AlertCircle size={9} className="text-red-400 shrink-0" />}
                  {hasWarn && <AlertTriangle size={9} className="text-amber-400 shrink-0" />}
                  <span>{lineNum}</span>
                </div>
              );
            })}
          </div>

          {/* Code Layer Container */}
          <div className="flex-1 relative min-w-0 min-h-0 overflow-hidden bg-[#18181b]">
            {/* Syntax-Highlighted Backdrop */}
            <pre
              ref={preRef}
              aria-hidden="true"
              className="absolute inset-0 m-0 pt-3 pb-8 px-4 font-mono text-[12px] leading-[19.5px] whitespace-pre overflow-hidden pointer-events-none select-none"
              style={{ tabSize: 2 }}
            >
              {highlightedLines.map((content, idx) => {
                const lineNum = idx + 1;
                const lineIssues = lineIssueMap.get(lineNum);
                const hasErr = lineIssues?.some(is => is.severity === 'error');
                const hasWarn = !hasErr && lineIssues && lineIssues.length > 0;
                const bg = hasErr
                  ? 'bg-red-900/20'
                  : hasWarn
                    ? 'bg-amber-900/15'
                    : activeLine === lineNum
                      ? 'bg-white/[0.03]'
                      : '';
                return (
                  <div key={lineNum} className={`h-[19.5px] ${bg}`}>
                    {content}
                  </div>
                );
              })}
            </pre>

            {/* Interactive Textarea */}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                updateActiveLineFromCursor();
              }}
              onScroll={syncScroll}
              onClick={updateActiveLineFromCursor}
              onKeyUp={updateActiveLineFromCursor}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              className="absolute inset-0 w-full h-full m-0 pt-3 pb-8 px-4 bg-transparent text-transparent caret-white font-mono text-[12px] leading-[19.5px] whitespace-pre overflow-auto resize-none outline-none border-none selection:bg-blue-500/35"
              style={{ tabSize: 2 }}
            />
          </div>
        </div>
      </div>
    );
  }
);

MugenCodeEditor.displayName = 'MugenCodeEditor';
