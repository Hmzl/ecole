/** Élèves issus de ListEleve_20260707.pdf (MAYSSANE, 2025/2026) */

function titleCase(s) {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** @type {{ className: string, students: { lastName: string, firstName: string }[] }[]} */
export const CLASSES_ELEVES = [
  {
    className: '6APG-1',
    students: [
      { lastName: 'Oulagmaz', firstName: 'Malak' },
      { lastName: 'Amezghal', firstName: 'Walid' },
      { lastName: 'Zaouli', firstName: 'Niema' },
      { lastName: 'Youmni', firstName: 'Lina' },
      { lastName: 'Benchehba', firstName: 'Amir' },
      { lastName: 'Karam', firstName: 'Mustapha' },
      { lastName: 'Sabri', firstName: 'Wiam' },
      { lastName: 'Chennouf', firstName: 'Wassim' },
      { lastName: 'Laaboud', firstName: 'Achraf' },
      { lastName: 'Elyahyaoui', firstName: 'Rim' },
      { lastName: 'Briache', firstName: 'Mohammed Riyad' },
      { lastName: 'El Machmachi', firstName: 'Houssam' },
      { lastName: 'Mouiz', firstName: 'Khadija' },
      { lastName: 'Elfard', firstName: 'Ilyasse Akrame' },
      { lastName: 'Moudjou', firstName: 'Aymen' },
      { lastName: 'Moudjou', firstName: 'Arwa' }
    ]
  },
  {
    className: '6APG-2',
    students: [
      { lastName: 'Taoufyq', firstName: 'Yassine' },
      { lastName: 'El Yazami Adli', firstName: 'Yahya' },
      { lastName: 'Jalil', firstName: 'Jad' },
      { lastName: 'Eddiakr', firstName: 'Sami' },
      { lastName: 'Bahouma', firstName: 'Mohamed' },
      { lastName: 'Nouisser', firstName: 'Ziyad' },
      { lastName: 'El Youbi', firstName: 'Joullanar' },
      { lastName: 'Ibnou Elmahdi', firstName: 'Faiz' },
      { lastName: 'Martil', firstName: 'Nouria' },
      { lastName: 'Mastiti', firstName: 'Hidaya' },
      { lastName: 'Taha', firstName: 'Noussair' },
      { lastName: 'Machkouri', firstName: 'Rayhana' },
      { lastName: 'Eddya', firstName: 'Marwa' },
      { lastName: 'Essayh', firstName: 'Omayma' },
      { lastName: 'El Arfaoui', firstName: 'Sirine' }
    ]
  }
];

/** Liste plate (compat) */
export const LIST_ELEVES = CLASSES_ELEVES.flatMap((c) =>
  c.students.map((s) => ({ ...s, className: c.className }))
);

export const CLASS_NAME = '6APG-1';

export { titleCase };
