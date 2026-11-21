import { AirData, AirAction, AirElement, ClsnBox } from "./types";

/**
 * Parses Animation Information (.AIR) formats.
 * Extracts Action names, Loopstart markers, Default & per-frame collision boxes, and frame elements.
 */
export function parseAirString(data: string): AirData {
  const actions: Record<number, AirAction> = {};
  let currentAction: AirAction | null = null;
  let defaultClsn1: ClsnBox[] = [];
  let defaultClsn2: ClsnBox[] = [];
  let frameClsn1: ClsnBox[] = [];
  let frameClsn2: ClsnBox[] = [];
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

      defaultClsn1 = [];
      defaultClsn2 = [];
      frameClsn1 = [];
      frameClsn2 = [];
      pendingName = "";
      continue;
    }

    pendingName = "";
    if (!currentAction) continue;

    const lowerLine = line.toLowerCase();

    if (lowerLine === "loopstart") {
      currentAction.loopstartIndex = currentAction.elements.length;
      continue;
    }

    // Check for global/frame specific Collision definition counts "Clsn2: 1"
    if (lowerLine.startsWith("clsn2default:")) continue;
    if (lowerLine.startsWith("clsn1default:")) continue;
    if (lowerLine.startsWith("clsn2:") || lowerLine.startsWith("clsn1:")) continue;

    // Matches Clsn box dimensions: "Clsn2[0] = -10, -20, 10, 0"
    const clsnMatch = line.match(/^Clsn([12])(Default)?\[(\d+)\]\s*=\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i);
    if (clsnMatch && currentAction) {
      const type = parseInt(clsnMatch[1], 10);
      const isDefault = Boolean(clsnMatch[2]);
      const boxId = parseInt(clsnMatch[3], 10);
      const box: ClsnBox = {
        id: boxId,
        x1: parseInt(clsnMatch[4], 10),
        y1: parseInt(clsnMatch[5], 10),
        x2: parseInt(clsnMatch[6], 10),
        y2: parseInt(clsnMatch[7], 10),
      };

      if (isDefault) {
        if (type === 1) {
          defaultClsn1.push(box);
          currentAction.clsn1.push({ ...box });
        } else {
          defaultClsn2.push(box);
          currentAction.clsn2.push({ ...box });
        }
      } else {
        if (type === 1) frameClsn1.push(box);
        else frameClsn2.push(box);
      }
      continue;
    }

    // Typical Frame Element: Group, Image, Xoffset, Yoffset, Time[, Flip[, Color]]
    const elementParts = line.split(",").map(s => s.trim());
    if (elementParts.length >= 5) {
      const element: AirElement = {
        group: parseInt(elementParts[0], 10) || 0,
        image: parseInt(elementParts[1], 10) || 0,
        xOffset: parseInt(elementParts[2], 10) || 0,
        yOffset: parseInt(elementParts[3], 10) || 0,
        time: parseInt(elementParts[4], 10) || 0,
        flip: elementParts[5] || "",
        color: elementParts[6] || "",
        ...(frameClsn1.length > 0 ? { clsn1: frameClsn1.map(b => ({ ...b })) } : {}),
        ...(frameClsn2.length > 0 ? { clsn2: frameClsn2.map(b => ({ ...b })) } : {}),
      };

      currentAction.elements.push(element);
      frameClsn1 = [];
      frameClsn2 = [];
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

    // Default Attack boxes (Clsn1Default)
    if (action.clsn1 && action.clsn1.length > 0) {
      output += `Clsn1Default: ${action.clsn1.length}\n`;
      action.clsn1.forEach((box, i) => {
        output += `  Clsn1Default[${i}] = ${box.x1},${box.y1},${box.x2},${box.y2}\n`;
      });
    }

    // Default Defense boxes (Clsn2Default)
    if (action.clsn2 && action.clsn2.length > 0) {
      output += `Clsn2Default: ${action.clsn2.length}\n`;
      action.clsn2.forEach((box, i) => {
        output += `  Clsn2Default[${i}] = ${box.x1},${box.y1},${box.x2},${box.y2}\n`;
      });
    }

    // Frame elements
    action.elements.forEach((el, elIdx) => {
      if (action.loopstartIndex === elIdx) {
        output += `Loopstart\n`;
      }

      if (el.clsn1 && el.clsn1.length > 0) {
        output += `Clsn1: ${el.clsn1.length}\n`;
        el.clsn1.forEach((box, i) => {
          output += `  Clsn1[${i}] = ${box.x1},${box.y1},${box.x2},${box.y2}\n`;
        });
      }

      if (el.clsn2 && el.clsn2.length > 0) {
        output += `Clsn2: ${el.clsn2.length}\n`;
        el.clsn2.forEach((box, i) => {
          output += `  Clsn2[${i}] = ${box.x1},${box.y1},${box.x2},${box.y2}\n`;
        });
      }

      let line = `${el.group}, ${el.image}, ${el.xOffset}, ${el.yOffset}, ${el.time}`;
      if (el.flip || el.color) {
        line += `, ${el.flip || ""}`;
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
