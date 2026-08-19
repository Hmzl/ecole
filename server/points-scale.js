export const MAX_POINTS = 100;
export const SCALE_20 = 20;

/** Convertit un score /100 vers /20 (une décimale). */
export function toScale20(points) {
  const n = Number(points);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n * SCALE_20) / MAX_POINTS * 10) / 10;
}

export function formatScale20(points) {
  const value = toScale20(points);
  return Number.isInteger(value) ? `${value}/20` : `${value.toFixed(1).replace('.', ',')}/20`;
}

function addUtcDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function periodBounds(period, value) {
  if (period === 'monthly') {
    const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      throw Object.assign(new Error('Mois invalide (attendu AAAA-MM)'), { status: 400 });
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) {
      throw Object.assign(new Error('Mois invalide'), { status: 400 });
    }
    const startDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endDay = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    return {
      start: `${startDay} 00:00:00`,
      end: `${endDay} 00:00:00`,
      label: new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('fr-FR', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      })
    };
  }

  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw Object.assign(new Error('Date invalide (attendu AAAA-MM-JJ)'), { status: 400 });
  }
  const ymd = `${match[1]}-${match[2]}-${match[3]}`;
  const check = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== ymd) {
    throw Object.assign(new Error('Date invalide'), { status: 400 });
  }
  return {
    start: `${ymd} 00:00:00`,
    end: `${addUtcDays(ymd, 1)} 00:00:00`,
    label: check.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    })
  };
}

export function scalePayload(points) {
  return {
    points: Number(points) || 0,
    outOf20: toScale20(points),
    display20: formatScale20(points)
  };
}
