function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDatetime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-');
  if (timeStr) {
    const [hours, minutes] = timeStr.split(':');
    return `${year}${month}${day}T${hours}${minutes}00`;
  }
  return `${year}${month}${day}`;
}

function formatEndDatetime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-');
  if (timeStr) {
    const [hours, minutes] = timeStr.split(':');
    let endHour = parseInt(hours, 10) + 1;
    if (endHour >= 24) endHour = 23;
    return `${year}${month}${day}T${pad(endHour)}${minutes}00`;
  }
  // All-day: end is next day
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function nowStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const CATEGORY_NAMES = {
  medica: 'Médica',
  examen: 'Examen',
  excursion: 'Excursión',
  deporte: 'Deporte',
  colegio: 'Colegio',
  otro: 'Otro'
};

function foldLine(line) {
  // ICS spec: lines should not exceed 75 octets; fold with CRLF + space
  if (line.length <= 75) return line;
  const parts = [];
  let remaining = line;
  parts.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    parts.push(' ' + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return parts.join('\r\n');
}

function generateICS(events, children) {
  const childMap = {};
  children.forEach(c => { childMap[c.id] = c; });

  const stamp = nowStamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mi Familia App//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Mi Familia',
    'X-WR-TIMEZONE:Europe/Madrid',
    'X-WR-CALDESC:Actividades familiares'
  ];

  events.forEach(event => {
    const allDay = !event.time;
    const dtStart = formatDatetime(event.date, event.time);
    const dtEnd = formatEndDatetime(event.date, event.time);
    const categoryName = CATEGORY_NAMES[event.category] || event.category;
    const childEmoji = event.child_emoji || '';
    const childName = event.child_name || '';
    const summary = `${childEmoji} ${childName} - ${event.title}`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:familia-event-${event.id}@miapp.local`);
    lines.push(`DTSTAMP:${stamp}`);

    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
      lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/Madrid:${dtStart}`);
      lines.push(`DTEND;TZID=Europe/Madrid:${dtEnd}`);
    }

    lines.push(foldLine(`SUMMARY:${summary}`));
    lines.push(`CATEGORIES:${categoryName}`);

    if (event.notes) {
      const cleanNotes = event.notes.replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
      lines.push(foldLine(`DESCRIPTION:${cleanNotes}`));
    }

    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { generateICS };
