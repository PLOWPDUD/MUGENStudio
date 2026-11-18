import { AirData, AirAction, AirElement, ClsnBox } from "./types";

/**
 * Parses Animation Information (.AIR) formats.
 * Extracts collision box states (Attack/Defense) and sprite coordination.
 */
export function parseAirString(data: string): AirData {
  const actions: Record<number, AirAction> = {};
  let currentAction: AirAction | null = null;
  let defaultClsn1: ClsnBox[] = [];
  let defaultClsn2: ClsnBox[] = [];
  let pendingName = "";

  const lines = data.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawTrimmed = lines[i].trim();
    if (!rawTrimmed) {
      pendingName = "";
      continue;
    }

    // Track preceding comment lines as potential Action names (FF3 / M.U.G.E.N style)
    if (rawTrimmed.startsWith(";")) {
      const commentBody = rawTrimmed.replace(/^;+/, "").trim();
      // Ignore pure divider lines (e.g. ;------- or ;=======) without clearing an existing pending name above a divider
      if (!commentBody || /^[-=*_~#|;:\s]+$/.test(commentBody)) {
        continue;
      }
      const cleanedName = commentBody
        .replace(/^[-=*_~#|]{2,}\s*/, "")
        .replace(/\s*[-=*_~#|]{2,}$/, "")
        .trim();
      if (cleanedName) {
        pendingName = cleanedName;
      }
      continue;
    }

    // Extract code part and optional inline comment
    const semiIdx = lines[i].indexOf(";");
    const line = (semiIdx !== -1 ? lines[i].slice(0, semiIdx) : lines[i]).trim();
    const inlineComment = semiIdx !== -1 ? lines[i].slice(semiIdx + 1).trim() : "";
    if (!line) continue;

    // Matches [Begin Action 0] with flexible spacing
    const actionMatch = line.match(/^\[\s*Begin\s+Action\s+([+-]?\d+)\s*\]$/i);
    if (actionMatch) {
      const id = parseInt(actionMatch[1], 10);
      const cleanedInline = inlineComment
        .replace(/^[-=*_~#|]{2,}\s*/, "")
        .replace(/\s*[-=*_~#|]{2,}$/, "")
        .trim();
      const resolvedName = cleanedInline || pendingName || undefined;
      currentAction = {
        id,
        ...(resolvedName ? { name: resolvedName } : {}),
        elements: [],
        clsn1: [],
        clsn2: []
      };
      actions[id] = currentAction;
      
      // Reset Default Collision blocks and pending comment name
      defaultClsn1 = [];
      defaultClsn2 = [];
      pendingName = "";
      continue;
    }

    pendingName = "";
    if (!currentAction) continue;

    const lowerLine = line.toLowerCase();

    // Check for global/frame specific Collision definition amounts "Clsn2: 1"
    if (lowerLine.startsWith("clsn2default:")) continue;
    if (lowerLine.startsWith("clsn1default:")) continue;
    if (lowerLine.startsWith("clsn2:") || lowerLine.startsWith("clsn1:")) continue;

    // Matches Clsn box dimensions: "Clsn2[0] = -10, -20, 10, 0"
    const clsnMatch = line.match(/^Clsn([12])(?:Default)?\[(\d+)\]\s*=\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i);
    if (clsnMatch && currentAction) {
      const type = parseInt(clsnMatch[1], 10); // 1 = Attack, 2 = Defense
      const boxId = parseInt(clsnMatch[2], 10);
      const box: ClsnBox = {
        id: boxId,
        x1: parseInt(clsnMatch[3], 10),
        y1: parseInt(clsnMatch[4], 10),
        x2: parseInt(clsnMatch[5], 10),
        y2: parseInt(clsnMatch[6], 10),
      };

      if (line.toLowerCase().includes("default")) {
          if (type === 1) defaultClsn1.push(box);
          else defaultClsn2.push(box);
      } else {
          if (type === 1) currentAction.clsn1.push(box);
          else currentAction.clsn2.push(box);
      }
      continue;
    }

    // Typical Frame Element: Group, Image, Xoffset, Yoffset, Time
    // E.g., "0, 0, 0, 0, 5, H"
    const elementParts = line.split(",").map(s => s.trim());
    if (elementParts.length >= 5) {
      const element: AirElement = {
        group: parseInt(elementParts[0], 10),
        image: parseInt(elementParts[1], 10),
        xOffset: parseInt(elementParts[2], 10),
        yOffset: parseInt(elementParts[3], 10),
        time: parseInt(elementParts[4], 10),
        flip: elementParts[5] || "",
        color: elementParts[6] || "",
      };
      
      // If the current sequence doesn't have frame-specific boxes, apply defaults
      if (currentAction.clsn1.length === 0 && defaultClsn1.length > 0) currentAction.clsn1 = [...defaultClsn1];
      if (currentAction.clsn2.length === 0 && defaultClsn2.length > 0) currentAction.clsn2 = [...defaultClsn2];

      currentAction.elements.push(element);
    }
  }

  return { actions };
}

/**
 * Serializes AirData structures back to an AIR formatted string.
 */
export function serializeAirData(air: AirData): string {
  let output = "";
  const sortedActionIds = Object.keys(air.actions)
    .map(Number)
    .sort((a, b) => a - b);

  for (const id of sortedActionIds) {
    const action = air.actions[id];
    if (action.name && action.name.trim()) {
      output += `; ${action.name.trim()}\n`;
    }
    output += `[Begin Action ${action.id}]\n`;
    
    // Attack boxes (Clsn1)
    if (action.clsn1 && action.clsn1.length > 0) {
      output += `Clsn1Default: ${action.clsn1.length}\n`;
      action.clsn1.forEach((box, i) => {
        output += `  Clsn1Default[${i}] = ${box.x1},${box.y1},${box.x2},${box.y2}\n`;
      });
    }

    // Defense boxes (Clsn2)
    if (action.clsn2 && action.clsn2.length > 0) {
      output += `Clsn2Default: ${action.clsn2.length}\n`;
      action.clsn2.forEach((box, i) => {
        output += `  Clsn2Default[${i}] = ${box.x1},${box.y1},${box.x2},${box.y2}\n`;
      });
    }

    // Frame elements: group, image, xOffset, yOffset, time, flip, color
    action.elements.forEach(el => {
      let line = `${el.group}, ${el.image}, ${el.xOffset}, ${el.yOffset}, ${el.time}`;
      if (el.flip) {
        line += `, ${el.flip}`;
      }
      if (el.color) {
        line += `, ${el.color}`;
      }
      output += `${line}\n`;
    });
    output += "\n";
  }
  return output.trim();
}

