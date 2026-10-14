// Step 1 of the method: map the recurring work and estimate where the hours go.
// ILLUSTRATIVE ESTIMATES for a fictional firm — in a real engagement these numbers are
// measured together with the team before anything is built.

export const PRACTICE = { klijenata: 120, napomena: 'Ilustrativna procjena za izmišljeni ured, ne mjerenje.' };

const PER_YEAR = { mjesečno: 12, tromjesečno: 4, godišnje: 1 };

const TASKS = [
  { posao: 'Knjiženje ulaznih računa', ucestalost: 'mjesečno', udio: 1.0, minuta: 120, podaci: 'visoka', rizik: 'srednji',
    odluka: 'SLJEDECE', obrazlozenje: 'Najviše sati, ali traži integraciju s ERP-om ureda. Logičan drugi korak.' },
  { posao: 'PDV usklada i prijava', ucestalost: 'mjesečno', udio: 1.0, minuta: 60, podaci: 'visoka', rizik: 'visok',
    odluka: 'PILOT', obrazlozenje: 'Svi klijenti, fiksan rok, skupe greške. Od Fiskalizacije 2.0 podaci su strukturirani, a rezultat se lako provjeri prema ručno napravljenoj prijavi.',
    minutaNakon: 15 },
  { posao: 'Banka i zatvaranje otvorenih stavki', ucestalost: 'mjesečno', udio: 1.0, minuta: 45, podaci: 'visoka', rizik: 'nizak',
    odluka: 'SLJEDECE', obrazlozenje: 'Uparivanje banke već radi unutar PDV pilota, može se proširiti.' },
  { posao: 'Obračun plaća i JOPPD', ucestalost: 'mjesečno', udio: 0.8, minuta: 40, podaci: 'srednja', rizik: 'visok',
    odluka: 'POMOC', obrazlozenje: 'Postoje specijalizirani alati; AI kao provjera, ne kao obračun.' },
  { posao: 'Prikupljanje dokumentacije od klijenata', ucestalost: 'mjesečno', udio: 1.0, minuta: 30, podaci: 'niska', rizik: 'nizak',
    odluka: 'POMOC', obrazlozenje: 'AI piše zahtjeve i podsjetnike; dio PDV pilota.' },
  { posao: 'Putni nalozi i troškovi zaposlenika', ucestalost: 'mjesečno', udio: 0.6, minuta: 30, podaci: 'niska', rizik: 'nizak',
    odluka: 'SLJEDECE', obrazlozenje: 'AI čita račune i fotografije, ali podaci su nestrukturirani.' },
  { posao: 'Izvještaji prema grupi (reporting package)', ucestalost: 'mjesečno', udio: 0.4, minuta: 90, podaci: 'srednja', rizik: 'srednji',
    odluka: 'POMOC', obrazlozenje: 'Svaka grupa ima svoj predložak; AI priprema nacrt.' },
  { posao: 'Statistički izvještaji', ucestalost: 'tromjesečno', udio: 0.5, minuta: 30, podaci: 'visoka', rizik: 'nizak',
    odluka: 'KASNIJE', obrazlozenje: 'Malo sati ukupno.' },
  { posao: 'Prijava poreza na dobit', ucestalost: 'godišnje', udio: 1.0, minuta: 240, podaci: 'srednja', rizik: 'visok',
    odluka: 'KASNIJE', obrazlozenje: 'Jednom godišnje, visoka stručna prosudba.' },
  { posao: 'Godišnji financijski izvještaji', ucestalost: 'godišnje', udio: 1.0, minuta: 600, podaci: 'srednja', rizik: 'visok',
    odluka: 'KASNIJE', obrazlozenje: 'Jednom godišnje, visoka stručna prosudba.' },
];

export function processMap() {
  const n = PRACTICE.klijenata;
  const rows = TASKS.map((t) => {
    const satiMjesecno = (PER_YEAR[t.ucestalost] / 12) * t.udio * n * (t.minuta / 60);
    const usteda = t.minutaNakon != null ? (PER_YEAR[t.ucestalost] / 12) * t.udio * n * ((t.minuta - t.minutaNakon) / 60) : null;
    return { ...t, satiMjesecno: Math.round(satiMjesecno), ustedaSatiMjesecno: usteda == null ? null : Math.round(usteda) };
  }).sort((a, b) => b.satiMjesecno - a.satiMjesecno);
  return { ...PRACTICE, ukupnoSatiMjesecno: rows.reduce((s, r) => s + r.satiMjesecno, 0), poslovi: rows };
}
