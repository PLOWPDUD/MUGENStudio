import { AirData, SffData } from './types';
import { getIniField, getSectionKeyValue, stripIniSuffix } from './defParser';

export interface MugenIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  source: 'AIR' | 'CNS' | 'CMD' | 'DEF';
  fileId?: string;
  fileName?: string;
  line?: number;
  actionId?: number;
  frameIndex?: number;
  message: string;
}

export interface ValidatorTextFile {
  id: string;
  filename: string;
  content: string;
  parsed?: Record<string, Record<string, string>> | null;
}

const STANDARD_COMMON_STATES = new Set<number>([
  0, 10, 11, 12, 20, 21, 40, 45, 47, 50, 51, 52, 100, 105, 106,
  120, 130, 131, 132, 140, 150, 151, 152, 153, 154, 155,
  170, 175, 180, 190, 195,
  5000, 5001, 5010, 5011, 5020, 5030, 5035, 5040, 5050, 5070, 5071,
  5080, 5081, 5100, 5101, 5110, 5120, 5150, 5200, 5201, 5210, 5500, 5900
]);

export function validateMugenProject(params: {
  iniData: Record<string, Record<string, string>> | null;
  sffData: SffData | null;
  airData: AirData | null;
  stFiles: ValidatorTextFile[];
  cmdFiles: ValidatorTextFile[];
}): MugenIssue[] {
  const { iniData, sffData, airData, stFiles, cmdFiles } = params;
  const issues: MugenIssue[] = [];

  // 1. Index sprites
  const spriteSet = new Set<string>();
  if (sffData?.images) {
    for (const img of sffData.images) {
      spriteSet.add(`${img.group},${img.image}`);
    }
  }

  // 2. Validate AIR frames against SFF
  if (airData && sffData) {
    Object.values(airData.actions).forEach(action => {
      action.elements.forEach((el, idx) => {
        // -1, 0 (or -1, *) is MUGEN's standard invisible/null sprite
        if (el.group === -1) return;
        if (!spriteSet.has(`${el.group},${el.image}`)) {
          issues.push({
            id: `air-missing-sprite-${action.id}-${idx}`,
            severity: 'warning',
            source: 'AIR',
            actionId: action.id,
            frameIndex: idx,
            message: `Action ${action.id}${action.name ? ` (${action.name})` : ''} Frame #${idx + 1} references missing sprite (${el.group}, ${el.image}).`
          });
        }
      });
    });
  }

  // 3. Collect all defined Statedefs and Command names
  const definedStatedefs = new Set<number>(STANDARD_COMMON_STATES);
  const definedCommands = new Set<string>();

  const scanDefinitions = (files: ValidatorTextFile[]) => {
    for (const file of files) {
      const lines = file.content.split(/\r?\n/);
      let inCommand = false;
      for (let i = 0; i < lines.length; i++) {
        const semi = lines[i].indexOf(';');
        const code = (semi !== -1 ? lines[i].slice(0, semi) : lines[i]).trim();
        if (!code) continue;

        const secMatch = code.match(/^\[(.*)\]$/);
        if (secMatch) {
          const header = secMatch[1].trim();
          const sdMatch = header.match(/^Statedef\s+(-?\d+)/i);
          if (sdMatch) {
            definedStatedefs.add(parseInt(sdMatch[1], 10));
          }
          inCommand = header.toLowerCase() === 'command';
          continue;
        }

        if (inCommand) {
          const nameMatch = code.match(/^name\s*=\s*"?([^"]+)"?$/i);
          if (nameMatch) {
            definedCommands.add(nameMatch[1].trim());
          }
        }
      }
    }
  };

  scanDefinitions(stFiles);
  scanDefinitions(cmdFiles);

  // 4. Scan CNS and CMD files line-by-line for broken references & syntax issues
  const scanCodeFile = (file: ValidatorTextFile, source: 'CNS' | 'CMD') => {
    const lines = file.content.split(/\r?\n/);
    let currentSection = '';
    let currentStateType = '';
    let hasTrigger1 = false;
    let inStateBlock = false;
    let stateHeaderLine = 0;

    const flushStateBlock = () => {
      if (inStateBlock && currentSection.toLowerCase().startsWith('state ')) {
        if (!currentStateType) {
          issues.push({
            id: `${source}-missing-type-${file.id}-${stateHeaderLine}`,
            severity: 'error',
            source,
            fileId: file.id,
            fileName: file.filename,
            line: stateHeaderLine,
            message: `[${currentSection}] is missing a 'type = ...' controller declaration.`
          });
        }
        if (!hasTrigger1) {
          issues.push({
            id: `${source}-missing-trigger-${file.id}-${stateHeaderLine}`,
            severity: 'warning',
            source,
            fileId: file.id,
            fileName: file.filename,
            line: stateHeaderLine,
            message: `[${currentSection}] has no 'trigger1' condition.`
          });
        }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const semi = lines[i].indexOf(';');
      const code = (semi !== -1 ? lines[i].slice(0, semi) : lines[i]).trim();
      if (!code) continue;

      if (code.startsWith('[') && !code.endsWith(']')) {
        issues.push({
          id: `${source}-unclosed-bracket-${file.id}-${lineNum}`,
          severity: 'error',
          source,
          fileId: file.id,
          fileName: file.filename,
          line: lineNum,
          message: `Unclosed section bracket on line ${lineNum}: ${code}`
        });
        continue;
      }

      const secMatch = code.match(/^\[(.*)\]$/);
      if (secMatch) {
        flushStateBlock();
        currentSection = secMatch[1].trim();
        currentStateType = '';
        hasTrigger1 = false;
        inStateBlock = currentSection.toLowerCase().startsWith('state ');
        stateHeaderLine = lineNum;
        continue;
      }

      const eq = code.indexOf('=');
      if (eq === -1) continue;
      const key = code.slice(0, eq).trim().toLowerCase();
      const val = code.slice(eq + 1).trim();

      if (key === 'type') {
        currentStateType = val.toLowerCase();
      } else if (key === 'trigger1' || key === 'triggerall') {
        if (key === 'trigger1') hasTrigger1 = true;
        // Check command = "xyz" references
        const cmdRefs = val.matchAll(/command\s*[!]?=\s*"([^"]+)"/gi);
        for (const m of cmdRefs) {
          const refName = m[1];
          if (definedCommands.size > 0 && !definedCommands.has(refName)) {
            issues.push({
              id: `${source}-missing-cmd-${file.id}-${lineNum}-${refName}`,
              severity: 'warning',
              source,
              fileId: file.id,
              fileName: file.filename,
              line: lineNum,
              message: `References undefined command "${refName}" in ${file.filename}:${lineNum}.`
            });
          }
        }
      }

      // Check anim = <int> in Statedef or ChangeAnim value = <int>
      if (
        airData &&
        ((key === 'anim' && /^-?\d+$/.test(val)) ||
          (currentStateType === 'changeanim' && key === 'value' && /^-?\d+$/.test(val)))
      ) {
        const animId = parseInt(val, 10);
        if (!airData.actions[animId]) {
          issues.push({
            id: `${source}-missing-anim-${file.id}-${lineNum}-${animId}`,
            severity: 'warning',
            source,
            fileId: file.id,
            fileName: file.filename,
            line: lineNum,
            message: `References Animation Action ${animId} which is not defined in .air (${file.filename}:${lineNum}).`
          });
        }
      }

      // Check ChangeState value = <int>
      if (currentStateType === 'changestate' && key === 'value' && /^-?\d+$/.test(val)) {
        const targetState = parseInt(val, 10);
        if (!definedStatedefs.has(targetState)) {
          issues.push({
            id: `${source}-missing-state-${file.id}-${lineNum}-${targetState}`,
            severity: 'warning',
            source,
            fileId: file.id,
            fileName: file.filename,
            line: lineNum,
            message: `ChangeState targets Statedef ${targetState}, which was not found in loaded .cns/.st/.cmd files (${file.filename}:${lineNum}).`
          });
        }
      }
    }
    flushStateBlock();
  };

  stFiles.forEach(f => scanCodeFile(f, 'CNS'));
  cmdFiles.forEach(f => scanCodeFile(f, 'CMD'));

  // 5. Check DEF Info / Files metadata
  if (iniData) {
    const charName = getIniField(iniData, 'Info', 'name');
    if (!charName.trim()) {
      issues.push({
        id: 'def-missing-name',
        severity: 'info',
        source: 'DEF',
        line: 1,
        message: 'Character [Info] name is empty in character.def.'
      });
    }
    const animRef = getIniField(iniData, 'Files', 'anim');
    if (!animRef.trim()) {
      issues.push({
        id: 'def-missing-anim-ref',
        severity: 'warning',
        source: 'DEF',
        message: 'No anim = <file.air> reference specified in [Files] of character.def.'
      });
    }
  }

  // Keep a small unused helper import clean
  void getSectionKeyValue;
  void stripIniSuffix;

  return issues;
}
