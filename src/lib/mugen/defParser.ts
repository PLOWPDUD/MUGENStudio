/**
 * Parses INI-style MUGEN text files (.def, .cns, .cmd).
 * Maps groups like [Info] or [StateDef 0] to properties and key-value pairs.
 */
export function parseIniString(data: string) {
  const result: Record<string, Record<string, string>> = {};
  let currentGroup = "Global";

  result[currentGroup] = {};

  const lines = data.split(/\r?\n/);
  const groupCount: Record<string, number> = {};
  const keyCount: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Ignore comments (MUGEN uses ';' for comments)
    const commentIdx = line.indexOf(';');
    if (commentIdx !== -1) {
      line = line.substring(0, commentIdx).trim();
    }
    
    if (!line) continue;

    // Check for [Group]
    let groupMatch = line.match(/^\[(.*)\]$/);
    if (groupMatch) {
      const baseGroup = groupMatch[1].trim();
      groupCount[baseGroup] = (groupCount[baseGroup] || 0) + 1;
      
      // Assign structured unique key name to group to display in explorer
      currentGroup = `${baseGroup} ##${groupCount[baseGroup]}`;
      if (!result[currentGroup]) {
        result[currentGroup] = {};
      }
      continue;
    }

    // Check for key = value or key = "value"
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const origKey = line.substring(0, eqIdx).trim().toLowerCase();
      let value = line.substring(eqIdx + 1).trim();
      
      // Create a unique key on state to prevent duplicate keys from overwriting each other (e.g., trigger1)
      const keyPath = `${currentGroup}::${origKey}`;
      keyCount[keyPath] = (keyCount[keyPath] || 0) + 1;
      const key = `${origKey} ##${keyCount[keyPath]}`;
      
      // Remove encapsulating quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      
      result[currentGroup][key] = value;
    }
  }

  // Cleanup Global if empty
  if (result["Global"] && Object.keys(result["Global"]).length === 0) {
    delete result["Global"];
  }

  return result;
}

/**
 * Stringifies parsed INI data back into MUGEN standardized text format.
 */
export function stringifyIni(data: Record<string, Record<string, string>>): string {
  let output = "";
  for (const group in data) {
    if (group !== "Global") {
      const cleanGroup = group.replace(/\s*##\d+$/, '');
      output += `\n[${cleanGroup}]\n`;
    }
    for (const key in data[group]) {
      const cleanKey = key.replace(/\s*##\d+$/, '');
      output += `${cleanKey} = ${data[group][key]}\n`;
    }
  }
  return output.trim();
}
