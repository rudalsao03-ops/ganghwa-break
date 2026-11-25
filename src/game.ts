/**
 * 강화 부수기 — 게임 본체
 *
 * 원본(단일 HTML, 「강화 부수기」)의 게임 로직·디자인·사운드를 그대로 옮기고,
 * 다음만 앱인토스 미니앱에 맞게 바꿨어요.
 *   1) 보상형 광고: 토스 SDK 연동(+ 미지원 환경은 3초 테스트 오버레이로 대체)
 *   2) 랭킹: 클로드 아티팩트 전용 DB → 기기 저장(localStorage) 기록 + 명예의 전당
 */
import { rewardedAd } from './tossAds';
import {
  cleanNick,
  FLOOR_HALL,
  loadRankRecord,
  LV_HALL,
  saveNick,
  syncRankRecord,
} from './ranking';

/* ===================== 유틸 ===================== */
const $ = <T extends Element = HTMLElement>(selector: string): T =>
  document.querySelector(selector) as T;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const fmt = (value: number): string => {
  const n = Math.floor(value);
  if (n >= 1e16) return `${(n / 1e16).toFixed(1)}경`;
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}조`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}만`;
  return String(n);
};

function toast(text: string): void {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(
    () => el.classList.remove('show'),
    1600,
  );
}

function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 진동 미지원 기기는 무시 */
  }
}

function result(text: string, color: string): void {
  const el = $('#res');
  el.textContent = text;
  el.style.color = color;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function flash(color: string): void {
  const el = $('#flash');
  el.style.background = `radial-gradient(circle at 50% 70%,${color},transparent 75%)`;
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
}

/* ===================== 밸런스 ===================== */
const RATE = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 16, 13, 10, 8, 6, 5, 4, 3, 2, 1];
const MAXLV = RATE.length;
const dmgOf = (l: number) => Math.round(5 * Math.pow(1.42, l));
const costOf = (l: number) => Math.round(30 * Math.pow(1.45, l));
const sellOf = (l: number) => (l < 5 ? 0 : Math.round(costOf(l) * 1.8 * Math.pow(1.08, l)));
const breakOf = (l: number) => (l < 10 ? 0 : Math.min(45, 8 + (l - 10) * 3));
const isBoss = (stage: number) => stage % 5 === 4;
const hpOf = (stage: number) => Math.round(60 * Math.pow(1.55, stage) * (isBoss(stage) ? 4 : 1));
const rewardOf = (stage: number) => Math.round(25 * Math.pow(1.5, stage) * (isBoss(stage) ? 5 : 1));
const critRate = () => 0.05 + G.lv * 0.004;
const BOSS_T = 30;

const WNAME = ['나무 몽둥이', '돌 망치', '쇠 망치', '강철 해머', '기사의 철퇴', '용사의 대검', '미스릴 해머', '룬 블레이드', '화염 대검', '뇌전 해머', '얼음 여왕의 검', '암흑 대검', '천공의 망치', '신룡의 검', '태양 파쇄기', '차원 절단기', '은하 해머', '성운 대검', '블랙홀 해머', '창세의 검', '종말의 망치', '신의 손', '우주 파괴자', '무한의 검', '초월자', '절대신', '???'];
const TIER = (l: number): [string, string] =>
  l < 5 ? ['#c3c8dc', '#7d849f'] : l < 10 ? ['#6dff9e', '#1f9a55'] : l < 15 ? ['#5ab8ff', '#1f5fd6'] : l < 20 ? ['#c57bff', '#7a2ed6'] : ['#ffd84d', '#ff6a00'];
const tierCol = (l: number, t: number) => (l >= 20 ? `hsl(${(t * 90) % 360} 100% 65%)` : TIER(l)[0]);

interface BuildingDef {
  n: string;
  w: number;
  h: number;
  c: string;
  roof?: 'tri' | 'flat' | 'castle' | 'spire' | 'dome';
  rc?: string;
  sign?: string;
  txt?: string;
  clock?: number;
  glass?: number;
}

const BLD: BuildingDef[] = [
  { n: '개집', w: 0.3, h: 0.2, c: '#b5733f', roof: 'tri', rc: '#7a3b2e' },
  { n: '초가집', w: 0.5, h: 0.24, c: '#e3c48a', roof: 'tri', rc: '#b08a3e' },
  { n: '컨테이너', w: 0.6, h: 0.22, c: '#3c8dbc', roof: 'flat' },
  { n: '편의점', w: 0.62, h: 0.28, c: '#eef0f6', roof: 'flat', sign: '#2fb35a', txt: '24시' },
  { n: '2층 주택', w: 0.52, h: 0.4, c: '#f0c9a0', roof: 'tri', rc: '#a14e3a' },
  { n: '학교', w: 0.82, h: 0.4, c: '#e0a96d', roof: 'flat', sign: '#c0392b', txt: '초등학교', clock: 1 },
  { n: '상가 건물', w: 0.6, h: 0.5, c: '#9aa5b8', roof: 'flat', sign: '#ff6b81', txt: '노래방' },
  { n: '아파트', w: 0.5, h: 0.72, c: '#dfe3ea', roof: 'flat', txt: '101동', sign: '#4c6fa8' },
  { n: '병원', w: 0.66, h: 0.62, c: '#f4f6fb', roof: 'flat', sign: '#e74c3c', txt: '✚ 병원' },
  { n: '백화점', w: 0.84, h: 0.58, c: '#c9a46a', roof: 'flat', sign: '#1b1f3b', txt: 'DEPT' },
  { n: '호텔', w: 0.5, h: 0.8, c: '#6b7a99', roof: 'flat', sign: '#ffd84d', txt: 'HOTEL' },
  { n: '오피스 빌딩', w: 0.46, h: 0.86, c: '#4c6fa8', roof: 'flat', glass: 1 },
  { n: '고성', w: 0.78, h: 0.62, c: '#8d8a9e', roof: 'castle' },
  { n: '방송국 타워', w: 0.24, h: 0.92, c: '#c9ced9', roof: 'spire' },
  { n: '초고층 타워', w: 0.36, h: 0.96, c: '#7fb2e5', roof: 'spire', glass: 1 },
  { n: '거대 요새', w: 0.9, h: 0.68, c: '#5d5470', roof: 'castle' },
  { n: '우주 정거장', w: 0.86, h: 0.46, c: '#b8c6e0', roof: 'dome', sign: '#5ab8ff', txt: 'STATION' },
  { n: '마왕성', w: 0.8, h: 0.88, c: '#3a2440', roof: 'castle', sign: '#ff4757', txt: '魔' },
];
const bOf = (stage: number) => BLD[stage % BLD.length];
const bName = (stage: number) =>
  (isBoss(stage) ? '[보스] ' : '') +
  bOf(stage).n +
  (stage >= BLD.length ? ` ${Math.floor(stage / BLD.length) + 1}회차` : '');

interface CrewDef {
  id: string;
  n: string;
  dps: number;
  cost: number;
  c: string;
  ab: string;
}

const CREW: CrewDef[] = [
  { id: 'w', n: '철거 인부', dps: 3, cost: 60, c: '#ffb347', ab: '인' },
  { id: 'ex', n: '포크레인', dps: 45, cost: 2500, c: '#ffd84d', ab: '굴' },
  { id: 'cr', n: '크레인 철구', dps: 700, cost: 9e4, c: '#ff8f5a', ab: '철' },
  { id: 'dy', n: '발파팀', dps: 12000, cost: 3.5e6, c: '#ff6b6b', ab: '폭' },
  { id: 'rb', n: '철거 로봇', dps: 2.2e5, cost: 1.4e8, c: '#7fe3ff', ab: '봇' },
  { id: 'sat', n: '레이저 위성', dps: 4.5e6, cost: 6e9, c: '#c57bff', ab: '위' },
];
const crewCost = (c: CrewDef, l: number) => Math.round(c.cost * Math.pow(1.17, l));
const crewDpsOf = (c: CrewDef, l: number) => c.dps * l * Math.pow(2, Math.floor(l / 25));
const totalDps = () => CREW.reduce((acc, c) => acc + crewDpsOf(c, G.crew[c.id] || 0), 0);

/* ===================== 상태 ===================== */
interface GameState {
  gold: number;
  lv: number;
  stage: number;
  hp: number;
  prot: number;
  best: number;
  breaks: number;
  crew: Record<string, number>;
  codex: boolean[];
  farm: boolean;
  mute: boolean;
  last: number;
  daily: string;
  top: number;
  nick: string;
}

const SAVE_KEY = 'gw_save2';

let G: GameState = {
  gold: 0,
  lv: 0,
  stage: 0,
  hp: hpOf(0),
  prot: 1,
  best: 0,
  breaks: 0,
  crew: {},
  codex: [],
  farm: false,
  mute: false,
  last: Date.now(),
  daily: '',
  top: 0,
  nick: '',
};

try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as Partial<GameState> | null;
  if (saved) G = { ...G, ...saved, crew: { ...(saved.crew || {}) } };
} catch {
  /* 저장 데이터가 깨졌으면 새로 시작 */
}
G.top = Math.max(G.top || 0, G.stage);
if (!G.nick) G.nick = loadRankRecord().nick;

function save(): void {
  G.last = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(G));
  } catch {
    /* 저장 실패는 조용히 무시 (사파리 프라이빗 모드 등) */
  }
  syncRecord();
}

/** 기기에 최고 기록을 남겨요. (랭킹 화면에서 사용) */
function syncRecord(): void {
  try {
    syncRankRecord(G.nick, (G.top || 0) + 1, G.best || 0);
  } catch {
    /* 기록 저장 실패는 무시 */
  }
}

let busy = false;
let parts: Part[] = [];
let nums: FloatingNumber[] = [];
let impacts: Impact[] = [];
let rings: Ring[] = [];
let shake = 0;
let swing = 0;
let atkT = 0;
let fall = 0;
let cracks: Crack[] = [];
let bossT = BOSS_T;
let combo = 0;
let lastTap = 0;
let fever = 0;
let crewT = 0;
let crewAcc = 0;
let crewShowT = 0;
let T = 0;
let dust: Dust[] = [];

interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  c: string;
  t: number;
  g: number;
  rot: number;
  smoke?: number;
}
interface FloatingNumber {
  x: number;
  y: number;
  v: number;
  t: number;
  crit?: boolean;
  crew?: number;
}
interface Impact {
  x: number;
  y: number;
  t: number;
  crit: boolean;
}
interface Ring {
  t: number;
  T: number;
}
interface Crack {
  x: number;
  y: number;
  a: number;
  l: number;
  at: number;
  hole: boolean;
  hr: number;
  seg: number[];
}
interface Dust {
  x: number;
  y: number;
  r: number;
  vx: number;
  t: number;
  T: number;
}

function newCracks(): void {
  cracks = Array.from({ length: 14 }, (_, i) => ({
    x: rnd(0.08, 0.92),
    y: rnd(0.1, 0.9),
    a: rnd(0, 6.28),
    l: rnd(0.12, 0.3),
    at: i / 14,
    hole: i % 3 === 0,
    hr: rnd(0.05, 0.1),
    seg: Array.from({ length: 4 }, () => rnd(-0.8, 0.8)),
  }));
}
newCracks();

/* ===================== 사운드 (WebAudio 합성) ===================== */
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
let AC: AudioContext | null = null;

function ac(): AudioContext | null {
  if (!AC) {
    try {
      AC = new ((window.AudioContext || (window as WebkitWindow).webkitAudioContext) as typeof AudioContext)();
    } catch {
      AC = null;
    }
  }
  if (AC && AC.state === 'suspended') void AC.resume();
  return AC;
}

function tone(freq: number, dur: number, type?: OscillatorType, vol?: number, slide?: number, when?: number): void {
  const a = AC;
  if (!a || G.mute) return;
  const t = a.currentTime + (when || 0);
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  gain.gain.setValueAtTime(vol || 0.06, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, cutoff: number): void {
  const a = AC;
  if (!a || G.mute) return;
  const n = Math.floor(a.sampleRate * dur);
  const buffer = a.createBuffer(1, n, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = a.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(a.destination);
  src.start();
}

const SFX = {
  hit: () => noise(0.07, 0.12, 1400),
  crit: () => {
    noise(0.12, 0.22, 3000);
    tone(900, 0.09, 'square', 0.04, 1.6);
  },
  up: (l: number) => {
    const base = l >= 15 ? 392 : 523;
    [1, 1.26, 1.5, 2].forEach((m, i) => tone(base * m, 0.18, 'triangle', 0.08, 0, i * 0.08));
    if (l >= 10) tone(base * 3, 0.5, 'triangle', 0.06, 0, 0.34);
  },
  fail: () => tone(320, 0.4, 'sawtooth', 0.05, 0.5),
  brk: () => {
    noise(0.9, 0.35, 500);
    tone(140, 0.7, 'sawtooth', 0.08, 0.35);
  },
  fall: () => {
    noise(1.3, 0.32, 260);
    tone(70, 1, 'sine', 0.15, 0.6);
  },
  coin: () => {
    tone(1300, 0.06, 'square', 0.035);
    tone(1750, 0.09, 'square', 0.035, 0, 0.06);
  },
  beat: () => tone(90, 0.12, 'sine', 0.25, 0.6),
  tick: () => tone(700, 0.04, 'square', 0.03),
  fever: () => [0, 1, 2, 3, 4].forEach((i) => tone(440 * Math.pow(1.19, i), 0.12, 'square', 0.05, 0, i * 0.06)),
};

window.addEventListener('pointerdown', ac, { once: false, passive: true });

const btnMute = $('#btnMute');
btnMute.onclick = () => {
  G.mute = !G.mute;
  btnMute.textContent = G.mute ? '소리 끔' : '소리 켬';
  save();
};
btnMute.textContent = G.mute ? '소리 끔' : '소리 켬';

/* ===================== UI ===================== */
document.querySelectorAll('#tabs button').forEach((button) => {
  (button as HTMLElement).onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === button));
    document.querySelectorAll('.tab').forEach((tab) =>
      tab.classList.toggle('on', tab.id === (button as HTMLElement).dataset.t),
    );
    renderLists();
  };
});

function ui(): void {
  const l = G.lv;
  const top = l >= MAXLV;
  $('#gold').textContent = `${fmt(G.gold)} 원`;
  const lvEl = $('#lv');
  lvEl.textContent = `+${l} ${WNAME[Math.min(l, WNAME.length - 1)]}`;
  lvEl.style.color = TIER(l)[0];
  $('#dmg').textContent = `공격력 ${fmt(dmgOf(l))} · 치명 ${Math.round(critRate() * 100)}%`;
  $('#sRate').textContent = top ? '-' : `${RATE[l]}%`;
  $('#sFail').textContent = l < 5 ? '유지' : '-1 하락';
  $('#sBreak').textContent = `${breakOf(l)}%`;
  $('#cost').textContent = top ? 'MAX' : `${fmt(costOf(l))} 원`;
  ($('#btnUp') as HTMLButtonElement).disabled = busy || top || G.gold < costOf(l);
  $('#sellAmt').textContent = sellOf(l) ? `${fmt(sellOf(l))} 원` : '+5부터';
  ($('#btnSell') as HTMLButtonElement).disabled = busy || !sellOf(l);
  $('#protN').textContent = String(G.prot);
  const protToggle = $('#useProt') as HTMLInputElement;
  protToggle.disabled = busy || !G.prot || breakOf(l) === 0;
  if (!G.prot || breakOf(l) === 0) protToggle.checked = false;
  $('#btnBoss').style.display = G.farm ? 'block' : 'none';
  if ($('#tCrew').classList.contains('on')) updCrewBtns();
}

function renderLists(): void {
  if ($('#tCrew').classList.contains('on')) {
    $('#crewList').innerHTML = CREW.map((c, i) => {
      const l = G.crew[c.id] || 0;
      const lock = i > 0 && !(G.crew[CREW[i - 1].id] > 0);
      return `<div class="row ${lock ? 'lock' : ''}"><div class="ic" style="background:${c.c}">${c.ab}</div><div><b>${c.n} Lv.${l}</b><small>초당 ${fmt(crewDpsOf(c, l))} → ${fmt(crewDpsOf(c, l + 1))}${l < 25 ? ' · Lv25에 2배' : ''}</small></div><button data-c="${c.id}" ${lock ? 'disabled' : ''}>${lock ? '잠김' : l ? '강화' : '고용'}<br>${fmt(crewCost(c, l))}</button></div>`;
    }).join('');
    updCrewBtns();
  }
  if ($('#tCodex').classList.contains('on')) {
    let count = 0;
    $('#codex').innerHTML = WNAME.map((name, i) => {
      const got = G.codex[i];
      if (got) count++;
      return `<div class="cx ${got ? '' : 'no'}" style="${got ? `border-color:${TIER(i)[0]}` : ''}"><b style="${got ? `color:${TIER(i)[0]}` : ''}">+${i}</b>${got ? name : '???'}</div>`;
    }).join('');
    $('#codexN').textContent = String(count);
  }
}

function updCrewBtns(): void {
  $('#crewDps').textContent = fmt(totalDps());
  document.querySelectorAll('#crewList button[data-c]').forEach((button) => {
    const el = button as HTMLButtonElement;
    const c = CREW.find((x) => x.id === el.dataset.c);
    if (!c) return;
    const i = CREW.indexOf(c);
    const lock = i > 0 && !(G.crew[CREW[i - 1].id] > 0);
    el.disabled = lock || G.gold < crewCost(c, G.crew[c.id] || 0);
  });
}

$('#crewList').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button[data-c]') as HTMLButtonElement | null;
  if (!button || button.disabled) return;
  const c = CREW.find((x) => x.id === button.dataset.c);
  if (!c) return;
  const l = G.crew[c.id] || 0;
  const cost = crewCost(c, l);
  if (G.gold < cost) return;
  G.gold -= cost;
  G.crew[c.id] = l + 1;
  SFX.coin();
  if (l === 0) toast(`${c.n} 합류!`);
  if (l + 1 === 25) toast(`${c.n} Lv25! 공격력 2배`);
  save();
  renderLists();
  ui();
});

/* ===================== 강화 ===================== */
function codexCheck(l: number): void {
  if (G.codex[l]) return;
  G.codex[l] = true;
  if (l >= 3) {
    const bonus = costOf(l) * 2;
    G.gold += bonus;
    window.setTimeout(() => toast(`도감 등록! +${l} ${WNAME[l]} · 보너스 ${fmt(bonus)}원`), 900);
  }
}
codexCheck(G.lv);

$('#btnUp').onclick = () => {
  const l = G.lv;
  if (busy || l >= MAXLV || G.gold < costOf(l)) return;
  ac();
  G.gold -= costOf(l);
  busy = true;
  ui();

  const dur = l >= 15 ? 2000 : l >= 10 ? 1400 : 650;
  const start = performance.now();
  const gauge = $('#gauge');
  const upTxt = $('#upTxt');
  upTxt.textContent = l >= 10 ? '두근두근...' : '강화 중...';

  const beat = window.setInterval(
    () => {
      SFX.beat();
      shake = Math.max(shake, l >= 10 ? 4 : 1);
    },
    l >= 10 ? 330 : 999999,
  );
  if (l < 10) SFX.tick();

  const step = () => {
    const p = Math.min(1, (performance.now() - start) / dur);
    (gauge as HTMLElement).style.width = `${p * 100}%`;
    if (p < 1) requestAnimationFrame(step);
  };
  step();
  rings.push({ t: dur / 1000, T: dur / 1000 });

  window.setTimeout(() => {
    clearInterval(beat);
    (gauge as HTMLElement).style.width = '0';
    const roll = Math.random() * 100;

    if (roll < RATE[l]) {
      G.lv++;
      if (G.lv > G.best) G.best = G.lv;
      const col = TIER(G.lv)[0];
      result(`+${G.lv} 성공!`, col);
      SFX.up(G.lv);
      buzz(G.lv >= 10 ? [60, 40, 140] : 40);
      for (let i = 0; i < (G.lv >= 10 ? 90 : 40); i++) parts.push(spark(col));
      if (G.lv >= 10) flash(col);
      if (G.lv >= 15) toast(`🔥 +${G.lv} ${WNAME[G.lv]} 탄생!`);
      codexCheck(G.lv);
    } else {
      const brk = breakOf(l);
      const protect = ($('#useProt') as HTMLInputElement).checked && G.prot > 0;
      if (brk && Math.random() * 100 < brk) {
        if (protect) {
          G.prot--;
          G.lv = Math.max(0, l - 1);
          result('방지권 발동!', '#5ab8ff');
          toast('파괴될 뻔! 방지권이 막았어요');
          SFX.fail();
        } else {
          G.lv = 0;
          G.breaks++;
          result('파괴...', '#ff4757');
          shake = 20;
          buzz([200, 80, 300]);
          SFX.brk();
          flash('rgba(255,40,60,.9)');
          for (let i = 0; i < 70; i++) parts.push(spark(i % 2 ? '#888' : '#ff4757'));
        }
      } else if (l >= 5) {
        G.lv = l - 1;
        result('실패 -1', '#ff8a8a');
        shake = 7;
        buzz(80);
        SFX.fail();
      } else {
        result('실패', '#ff8a8a');
        buzz(60);
        SFX.fail();
      }
    }
    upTxt.textContent = '강화하기';
    busy = false;
    save();
    ui();
    renderLists();
  }, dur);
};

$('#btnSell').onclick = () => {
  const value = sellOf(G.lv);
  if (!value || busy) return;
  G.gold += value;
  toast(`+${G.lv} ${WNAME[G.lv]} 판매! ${fmt(value)}원`);
  SFX.coin();
  G.lv = 0;
  save();
  ui();
};

/* ===================== 보상형 광고 ===================== */
let adBusy = false;

/** 토스 앱이 아닌 환경(일반 브라우저·GitHub Pages 미리보기)에서 쓰는 3초 테스트 광고 */
function fallbackAdOverlay(done: () => void): void {
  const overlay = $('#ovAd');
  if (overlay.classList.contains('show')) return; // 중복 실행 방지
  $('#adNote').textContent = '웹 미리보기용 테스트 광고예요';
  overlay.classList.add('show');
  let n = 3;
  $('#adN').textContent = String(n);
  const timer = window.setInterval(() => {
    n--;
    $('#adN').textContent = String(n);
    if (n <= 0) {
      clearInterval(timer);
      overlay.classList.remove('show');
      done();
    }
  }, 1000);
}

/**
 * 보상형 광고를 띄우고, 보상을 받았을 때만 done() 을 실행해요.
 * - 토스 앱: SDK 광고 (userEarnedReward 일 때만 보상)
 * - 그 외: 3초 테스트 오버레이로 자연스럽게 대체
 */
function showAd(done: () => void): void {
  if (adBusy) return;

  if (!rewardedAd.isSupported()) {
    fallbackAdOverlay(done);
    return;
  }

  adBusy = true;
  const adButton = $('#btnAd') as HTMLButtonElement;
  adButton.disabled = true;
  if (!rewardedAd.isReady()) toast('광고 준비 중...');

  void rewardedAd
    .show()
    .then((outcome) => {
      if (outcome === 'rewarded') {
        done();
      } else if (outcome === 'dismissed') {
        toast('광고를 끝까지 봐야 보상이 지급돼요');
      } else if (outcome === 'failed') {
        toast('광고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    })
    .catch((error) => {
      console.warn('[ads] 광고 처리 중 문제가 생겼어요.', error);
      toast('광고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요');
    })
    .finally(() => {
      adBusy = false;
      adButton.disabled = false;
    });
}

$('#btnAd').onclick = () => {
  showAd(() => {
    G.prot++;
    save();
    ui();
    toast('파괴 방지권 +1');
  });
};

$('#btnBoss').onclick = () => {
  G.farm = false;
  G.stage++;
  G.hp = hpOf(G.stage);
  bossT = BOSS_T;
  newCracks();
  save();
  ui();
  toast('보스 재도전! 30초');
};

/* ===================== 전투 ===================== */
function hit(src: 'tap' | 'auto' | 'crew', mult: number, px?: number, py?: number): void {
  if (fall > 0) return;
  let damage = src === 'crew' ? mult : dmgOf(G.lv) * mult;
  let crit = false;
  if (src !== 'crew') {
    crit = Math.random() < critRate();
    if (crit) damage *= 3;
    if (fever > 0) damage *= 2;
  }
  damage = Math.max(1, Math.round(damage));
  G.hp -= damage;

  if (src !== 'crew') {
    shake = Math.max(shake, crit ? 8 : 3);
    swing = 1;
    impacts.push({ x: px ?? 0, y: py ?? 0, t: 0.2, crit });
    if (src === 'tap' || Math.random() < 0.6) SFX[crit ? 'crit' : 'hit']();
    for (let i = 0; i < (crit ? 10 : 4); i++) parts.push(debris(px ?? 0, py ?? 0));
    nums.push({ x: px ?? 0, y: py ?? 0, v: damage, t: 0.9, crit });
  }

  if (G.hp <= 0) destroy();
}

function destroy(): void {
  G.hp = 0;
  fall = 1.4;
  const reward = rewardOf(G.stage) * (fever > 0 ? 2 : 1);
  G.gold += reward;
  const boss = isBoss(G.stage);
  toast(`${bName(G.stage)} 철거! +${fmt(reward)}원${fever > 0 ? ' (피버 2배)' : ''}`);
  buzz([40, 30, 40, 30, 150]);
  SFX.fall();
  window.setTimeout(SFX.coin, 400);

  for (let i = 0; i < 80; i++) parts.push(debris(rnd(B.x, B.x + B.w), rnd(B.y, B.y + B.h), true));
  for (let i = 0; i < 14; i++) dust.push({ x: rnd(B.x, B.x + B.w), y: GROUND, r: rnd(20, 50), vx: rnd(-40, 40), t: 2, T: 2 });
  if (boss) {
    result('보스 철거!', '#ffd84d');
    flash('rgba(255,216,77,.8)');
  }
}

function debris(x: number, y: number, big?: boolean): Part {
  return {
    x,
    y,
    vx: rnd(-150, 150),
    vy: rnd(-300, -60),
    r: big ? rnd(3, 9) : rnd(2, 4),
    c: Math.random() < 0.3 ? '#555' : bOf(G.stage).c,
    t: big ? 1.6 : 0.7,
    g: 1,
    rot: rnd(0, 6),
  };
}

function spark(c: string): Part {
  return { x: WX, y: WY - 40, vx: rnd(-280, 280), vy: rnd(-420, -80), r: rnd(2, 5), c, t: rnd(0.6, 1.2), g: 0.6, rot: 0 };
}

/* ===================== 그리기 ===================== */
const cv = $('#cv') as HTMLCanvasElement;
const cx = cv.getContext('2d') as CanvasRenderingContext2D;
let W = 0;
let H = 0;
let GROUND = 0;
let WX = 0;
let WY = 0;
let B = { x: 0, y: 0, w: 0, h: 0 };

function resize(): void {
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  W = rect.width;
  H = rect.height;
  cv.width = W * dpr;
  cv.height = H * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  GROUND = H * 0.8;
  WX = W * 0.82;
  WY = H * 0.97;
  buildSky();
}
window.addEventListener('resize', resize);

cv.addEventListener('pointerdown', (event) => {
  const rect = cv.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (!(x > B.x - 24 && x < B.x + B.w + 24 && y > B.y - 40 && y < GROUND + 10)) return;
  const now = performance.now();
  combo = now - lastTap < 650 ? combo + 1 : 1;
  lastTap = now;
  const mult = 0.6 * (1 + Math.min(combo, 50) * 0.04);
  hit('tap', mult, x, y);
  if (combo >= 40 && fever <= 0) {
    fever = 7;
    combo = 0;
    result('FEVER!', '#ff5ec4');
    SFX.fever();
    flash('rgba(255,94,196,.7)');
    buzz([50, 30, 50, 30, 50]);
  }
});

interface SkyBuilding {
  x: number;
  w: number;
  h: number;
  win?: boolean[];
}
type Star = [number, number, number, number];
interface Cloud {
  x: number;
  y: number;
  s: number;
  v: number;
}

let farSky: SkyBuilding[] = [];
let nearSky: SkyBuilding[] = [];
let stars: Star[] = [];
let clouds: Cloud[] = [];

function buildSky(): void {
  stars = Array.from(
    { length: 60 },
    () => [Math.random(), Math.random() * 0.6, Math.random() * 1.5 + 0.4, Math.random() * 6] as Star,
  );
  farSky = [];
  let x = 0;
  while (x < W) {
    const w = rnd(26, 60);
    farSky.push({ x, w, h: rnd(0.1, 0.3) * H });
    x += w + rnd(2, 6);
  }
  nearSky = [];
  x = -10;
  while (x < W) {
    const w = rnd(34, 70);
    nearSky.push({
      x,
      w,
      h: rnd(0.08, 0.22) * H,
      win: Array.from({ length: 30 }, () => Math.random() < 0.35),
    });
    x += w + rnd(4, 14);
  }
  clouds = Array.from({ length: 4 }, () => ({
    x: Math.random() * W,
    y: rnd(0.08, 0.35) * H,
    s: rnd(0.6, 1.3),
    v: rnd(4, 10),
  }));
}

function rr(x: number, y: number, w: number, h: number, r: number): void {
  const ctx = cx as CanvasRenderingContext2D & {
    roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
  };
  cx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else cx.rect(x, y, w, h);
}

function drawSky(): void {
  const fv = fever > 0;
  const g = cx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, fv ? '#3a0f3d' : '#0d1236');
  g.addColorStop(0.6, fv ? '#7a1f5c' : '#2c2457');
  g.addColorStop(1, fv ? '#c0396b' : '#5b3560');
  cx.fillStyle = g;
  cx.fillRect(0, 0, W, GROUND);

  for (const s of stars) {
    cx.globalAlpha = 0.25 + 0.35 * Math.sin(T * 1.5 + s[3]);
    cx.fillStyle = '#fff';
    cx.fillRect(s[0] * W, s[1] * H, s[2], s[2]);
  }
  cx.globalAlpha = 1;

  // 달
  const mx = W * 0.15;
  const my = H * 0.13;
  const mr = Math.min(W, H) * 0.06;
  const mg = cx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3);
  mg.addColorStop(0, 'rgba(255,240,200,.25)');
  mg.addColorStop(1, 'rgba(255,240,200,0)');
  cx.fillStyle = mg;
  cx.fillRect(mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
  cx.fillStyle = '#fff3cf';
  cx.beginPath();
  cx.arc(mx, my, mr, 0, 7);
  cx.fill();
  cx.fillStyle = 'rgba(200,180,140,.35)';
  cx.beginPath();
  cx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, 7);
  cx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.15, 0, 7);
  cx.fill();

  // 구름
  cx.fillStyle = 'rgba(255,255,255,.07)';
  for (const c of clouds) {
    c.x += c.v * 0.016;
    if (c.x > W + 80) c.x = -80;
    cx.beginPath();
    cx.ellipse(c.x, c.y, 50 * c.s, 14 * c.s, 0, 0, 7);
    cx.ellipse(c.x + 30 * c.s, c.y - 8 * c.s, 30 * c.s, 12 * c.s, 0, 0, 7);
    cx.fill();
  }

  // 먼 도시
  cx.fillStyle = fv ? '#4a1540' : '#251d48';
  for (const b of farSky) cx.fillRect(b.x, GROUND - b.h, b.w, b.h);

  // 가까운 도시
  for (const b of nearSky) {
    cx.fillStyle = fv ? '#2e0c2a' : '#1a1536';
    cx.fillRect(b.x, GROUND - b.h, b.w, b.h);
    cx.fillStyle = 'rgba(255,220,130,.55)';
    let k = 0;
    for (let yy = GROUND - b.h + 8; yy < GROUND - 8; yy += 12) {
      for (let xx = b.x + 5; xx < b.x + b.w - 6; xx += 10) {
        if (b.win && b.win[k++ % 30]) cx.fillRect(xx, yy, 4, 5);
      }
    }
  }

  // 땅·도로
  cx.fillStyle = '#2a2340';
  cx.fillRect(0, GROUND, W, 8);
  const rg = cx.createLinearGradient(0, GROUND + 8, 0, H);
  rg.addColorStop(0, '#1c1a2b');
  rg.addColorStop(1, '#0e0d18');
  cx.fillStyle = rg;
  cx.fillRect(0, GROUND + 8, W, H - GROUND);
  cx.fillStyle = 'rgba(255,220,120,.5)';
  for (let x = -(T * 30) % 40; x < W; x += 40) cx.fillRect(x, GROUND + (H - GROUND) * 0.55, 20, 3);
}

function drawBuilding(b: BuildingDef, x: number, y: number, w: number, h: number, ratio: number, boss: boolean): void {
  // 그림자
  cx.fillStyle = 'rgba(0,0,0,.4)';
  cx.beginPath();
  cx.ellipse(x + w / 2, y + h + 2, w * 0.62, 9, 0, 0, 7);
  cx.fill();
  if (boss) {
    const ag = cx.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, Math.max(w, h));
    ag.addColorStop(0, 'rgba(255,60,80,.35)');
    ag.addColorStop(1, 'rgba(255,60,80,0)');
    cx.fillStyle = ag;
    cx.fillRect(x - w, y - h * 0.6, w * 3, h * 2);
  }

  // 지붕 (몸통 뒤)
  const rc = b.rc || shade(b.c, -0.25);
  cx.fillStyle = rc;
  if (b.roof === 'tri') {
    cx.beginPath();
    cx.moveTo(x - w * 0.08, y + 2);
    cx.lineTo(x + w / 2, y - h * 0.5);
    cx.lineTo(x + w * 1.08, y + 2);
    cx.fill();
    cx.fillStyle = 'rgba(255,255,255,.12)';
    cx.beginPath();
    cx.moveTo(x - w * 0.08, y + 2);
    cx.lineTo(x + w / 2, y - h * 0.5);
    cx.lineTo(x + w * 0.5, y + 2);
    cx.fill();
  } else if (b.roof === 'castle') {
    const tw = w * 0.2;
    for (const tx of [x - tw * 0.4, x + w - tw * 0.6]) {
      cx.fillStyle = shade(b.c, -0.1);
      cx.fillRect(tx, y - h * 0.32, tw, h * 0.32 + 2);
      for (let i = 0; i < 3; i++) if (i !== 1) cx.fillRect(tx + (i * tw) / 3, y - h * 0.32 - 10, tw / 3, 10);
      cx.fillStyle = rc;
      cx.beginPath();
      cx.moveTo(tx - 4, y - h * 0.32 - 10);
      cx.lineTo(tx + tw / 2, y - h * 0.55);
      cx.lineTo(tx + tw + 4, y - h * 0.32 - 10);
      cx.fill();
      cx.fillStyle = '#ff4757';
      cx.fillRect(tx + tw / 2, y - h * 0.65, 2, h * 0.1);
      cx.beginPath();
      cx.moveTo(tx + tw / 2 + 2, y - h * 0.65);
      cx.lineTo(tx + tw / 2 + 16 + Math.sin(T * 4) * 3, y - h * 0.62);
      cx.lineTo(tx + tw / 2 + 2, y - h * 0.59);
      cx.fill();
    }
    cx.fillStyle = b.c;
    for (let i = 0; i < 8; i++) if (i % 2 === 0) cx.fillRect(x + (i * w) / 8, y - 12, w / 8, 13);
  } else if (b.roof === 'spire') {
    cx.beginPath();
    cx.moveTo(x + w * 0.25, y + 1);
    cx.lineTo(x + w / 2, y - h * 0.25);
    cx.lineTo(x + w * 0.75, y + 1);
    cx.fill();
    cx.fillStyle = shade(b.c, 0.2);
    cx.fillRect(x + w * 0.47, y - h * 0.38, w * 0.06, h * 0.14);
    cx.fillStyle = Math.sin(T * 5) > 0 ? '#ff4757' : '#5a1a22';
    cx.beginPath();
    cx.arc(x + w / 2, y - h * 0.39, 4, 0, 7);
    cx.fill();
  } else if (b.roof === 'dome') {
    cx.fillStyle = shade(b.c, 0.1);
    cx.beginPath();
    cx.ellipse(x + w / 2, y + 2, w * 0.32, h * 0.35, 0, Math.PI, 0);
    cx.fill();
    cx.fillStyle = 'rgba(90,184,255,.35)';
    cx.beginPath();
    cx.ellipse(x + w / 2, y + 2, w * 0.22, h * 0.24, 0, Math.PI, 0);
    cx.fill();
    cx.strokeStyle = shade(b.c, -0.2);
    cx.lineWidth = 4;
    cx.beginPath();
    cx.moveTo(x - w * 0.06, y + h * 0.4);
    cx.lineTo(x + w * 1.06, y + h * 0.4);
    cx.stroke();
  } else {
    // 옥상 소품
    cx.fillStyle = shade(b.c, -0.3);
    cx.fillRect(x - 3, y - 5, w + 6, 6);
    cx.fillStyle = '#8890a8';
    cx.fillRect(x + w * 0.12, y - 14, w * 0.14, 9);
    cx.fillRect(x + w * 0.3, y - 11, w * 0.1, 6);
    cx.fillStyle = '#6a6f85';
    cx.fillRect(x + w * 0.75, y - 26, 2, 21);
    cx.beginPath();
    cx.arc(x + w * 0.75 + 1, y - 27, 3, 0, 7);
    cx.fill();
    if (h > H * 0.3) {
      cx.fillStyle = '#7d5a3a';
      cx.fillRect(x + w * 0.5, y - 20, w * 0.14, 15);
      cx.fillRect(x + w * 0.52, y - 5, 2, 5);
      cx.fillRect(x + w * 0.6, y - 5, 2, 5);
    }
  }

  // 몸통
  const bg = cx.createLinearGradient(x, 0, x + w, 0);
  bg.addColorStop(0, shade(b.c, 0.08));
  bg.addColorStop(0.7, b.c);
  bg.addColorStop(1, shade(b.c, -0.28));
  cx.fillStyle = bg;
  cx.fillRect(x, y, w, h);

  // 층 띠
  const floors = Math.max(1, Math.round(h / 28));
  const fh = h / floors;
  const cols = Math.max(1, Math.round(w / 24));
  const cw = w / cols;
  cx.fillStyle = 'rgba(0,0,0,.1)';
  for (let f = 1; f < floors; f++) cx.fillRect(x, y + f * fh - 1, w, 2);

  // 창문
  for (let r = 0; r < floors; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = x + c * cw + cw * 0.2;
      const wy = y + r * fh + fh * 0.2;
      const ww = cw * 0.6;
      const wh = fh * 0.52;
      if (r === floors - 1 && c === Math.floor(cols / 2)) {
        cx.fillStyle = '#2a1d16';
        cx.fillRect(x + c * cw + cw * 0.15, y + r * fh + fh * 0.2, cw * 0.7, fh * 0.8);
        cx.fillStyle = '#ffcf6a';
        cx.fillRect(x + c * cw + cw * 0.48, y + r * fh + fh * 0.55, 3, 3);
        continue;
      }
      const lit = (r * 7 + c * 13 + G.stage * 3) % 5 > 1;
      if (b.glass) {
        cx.fillStyle = lit ? 'rgba(160,220,255,.75)' : 'rgba(40,70,120,.8)';
        cx.fillRect(x + c * cw + 1, y + r * fh + 2, cw - 2, fh - 4);
        continue;
      }
      cx.fillStyle = shade(b.c, -0.35);
      cx.fillRect(wx - 1.5, wy - 1.5, ww + 3, wh + 3);
      cx.fillStyle = lit ? '#ffe39a' : '#273058';
      cx.fillRect(wx, wy, ww, wh);
      if (lit) {
        cx.fillStyle = 'rgba(255,255,255,.35)';
        cx.fillRect(wx, wy, ww * 0.35, wh);
      }
    }
  }
  if (b.clock) {
    cx.fillStyle = '#fff';
    cx.beginPath();
    cx.arc(x + w / 2, y, 12, 0, 7);
    cx.fill();
    cx.strokeStyle = '#333';
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(x + w / 2, y);
    cx.lineTo(x + w / 2 + Math.cos(T) * 8, y + Math.sin(T) * 8);
    cx.stroke();
  }
  if (b.sign) {
    const sh = Math.min(22, h * 0.14);
    const sw = w * 0.62;
    cx.fillStyle = b.sign;
    rr(x + (w - sw) / 2, y + 6, sw, sh, 4);
    cx.fill();
    if (b.txt) {
      const dark = ['#1b1f3b', '#4c6fa8', '#c0392b', '#e74c3c', '#2fb35a', '#ff4757'].includes(b.sign);
      cx.fillStyle = dark ? '#fff' : '#1b1f3b';
      cx.font = `400 ${Math.round(sh * 0.7)}px "Black Han Sans",sans-serif`;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(b.txt, x + w / 2, y + 6 + sh / 2 + 1);
    }
  }

  // 하단 인도
  cx.fillStyle = shade(b.c, -0.4);
  cx.fillRect(x - 6, y + h - 4, w + 12, 5);

  // 손상: 금·구멍·불
  const dmg = 1 - ratio;
  for (const k of cracks) {
    if (k.at > dmg * 1.15) continue;
    const sx = x + k.x * w;
    const sy = y + k.y * h;
    if (k.hole && k.at < dmg * 0.9) {
      const hr = k.hr * Math.min(w, h);
      cx.fillStyle = '#120d1c';
      cx.beginPath();
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * 6.28;
        const radius = hr * (0.7 + 0.3 * Math.abs(k.seg[i % 4]));
        cx.lineTo(sx + Math.cos(ang) * radius, sy + Math.sin(ang) * radius);
      }
      cx.fill();
      if (dmg > 0.7) {
        cx.fillStyle = `rgba(255,${(120 + Math.random() * 80) | 0},40,.9)`;
        cx.beginPath();
        cx.moveTo(sx - hr * 0.5, sy + hr * 0.3);
        cx.lineTo(sx + rnd(-3, 3), sy - hr * rnd(1, 1.6));
        cx.lineTo(sx + hr * 0.5, sy + hr * 0.3);
        cx.fill();
      }
    }
    cx.strokeStyle = 'rgba(15,8,12,.8)';
    cx.lineWidth = 1.8;
    cx.beginPath();
    cx.moveTo(sx, sy);
    let px = sx;
    let py = sy;
    for (let i = 0; i < 4; i++) {
      const ang = k.a + k.seg[i];
      px += (Math.cos(ang) * k.l * w) / 4;
      py += (Math.sin(ang) * k.l * h) / 4;
      cx.lineTo(px, py);
    }
    cx.stroke();
  }
  if (dmg > 0.5 && Math.random() < 0.25) {
    parts.push({
      x: rnd(x, x + w),
      y: y + rnd(0, h * 0.5),
      vx: rnd(-10, 10),
      vy: rnd(-40, -20),
      r: rnd(6, 12),
      c: 'rgba(60,55,70,.5)',
      t: 1.6,
      g: -0.02,
      rot: 0,
      smoke: 1,
    });
  }
}

function shade(hex: string, p: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(p < 0 ? v * (1 + p) : v + (255 - v) * p)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function drawWeapon(x: number, y: number, l: number, ang: number): void {
  const s = Math.min(W * 0.3, H * 0.26);
  const c1 = tierCol(l, T);
  const c2 = l >= 20 ? `hsl(${(T * 90 + 60) % 360} 100% 50%)` : TIER(l)[1];
  if (l >= 10) {
    const n = Math.min(12, l - 6);
    for (let i = 0; i < n; i++) {
      const a = T * 2 + (i / n) * 6.28;
      cx.fillStyle = c1;
      cx.globalAlpha = 0.6;
      cx.beginPath();
      cx.arc(x + Math.cos(a) * s * 0.45, y - s * 0.5 + Math.sin(a) * s * 0.2, 2.5, 0, 7);
      cx.fill();
    }
    cx.globalAlpha = 1;
  }
  cx.save();
  cx.translate(x, y);
  cx.rotate(ang);
  if (l >= 5) {
    cx.shadowColor = c1;
    cx.shadowBlur = 8 + Math.min(l, 26) * 1.3;
  }
  cx.fillStyle = '#5a3b22';
  rr(-4, -s * 0.2, 8, s * 0.8, 3);
  cx.fill();
  cx.fillStyle = '#3a2414';
  for (let i = 0; i < 4; i++) cx.fillRect(-4, s * 0.05 + i * s * 0.12, 8, 3);
  const g = cx.createLinearGradient(-s * 0.3, -s, s * 0.3, -s * 0.2);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.25, c1);
  g.addColorStop(1, c2);
  cx.fillStyle = g;
  const sword = l % 2 === 1 && l >= 5;
  if (!sword) {
    rr(-s * 0.34, -s * 0.58, s * 0.68, s * 0.4, 8);
    cx.fill();
    cx.fillStyle = 'rgba(255,255,255,.35)';
    cx.fillRect(-s * 0.3, -s * 0.54, s * 0.6, s * 0.07);
    cx.fillStyle = c2;
    cx.fillRect(-s * 0.36, -s * 0.42, s * 0.72, s * 0.06);
  } else {
    cx.beginPath();
    cx.moveTo(-s * 0.09, -s * 0.18);
    cx.lineTo(-s * 0.09, -s * 0.9);
    cx.lineTo(0, -s * 1.05);
    cx.lineTo(s * 0.09, -s * 0.9);
    cx.lineTo(s * 0.09, -s * 0.18);
    cx.fill();
    cx.fillStyle = 'rgba(255,255,255,.45)';
    cx.fillRect(-s * 0.02, -s * 0.9, s * 0.03, s * 0.7);
    cx.fillStyle = c2;
    rr(-s * 0.26, -s * 0.22, s * 0.52, s * 0.08, 3);
    cx.fill();
  }
  cx.shadowBlur = 0;
  cx.restore();
}

function drawCrew(): void {
  const gy = GROUND + (H - GROUND) * 0.32;
  const workers = G.crew.w || 0;
  for (let i = 0; i < Math.min(workers, 5); i++) {
    const x = B.x - 16 - i * 15;
    const sw = Math.sin(T * 8 + i) * 0.8;
    if (x < -10) break;
    cx.fillStyle = '#ffb347';
    cx.beginPath();
    cx.arc(x, gy - 16, 4, 0, 7);
    cx.fill();
    cx.fillStyle = '#ffd84d';
    cx.fillRect(x - 4, gy - 21, 8, 3);
    cx.fillStyle = '#3c6fd6';
    cx.fillRect(x - 3, gy - 12, 6, 9);
    cx.fillStyle = '#222';
    cx.fillRect(x - 3, gy - 3, 2, 4);
    cx.fillRect(x + 1, gy - 3, 2, 4);
    cx.save();
    cx.translate(x + 3, gy - 10);
    cx.rotate(-0.6 + sw);
    cx.fillStyle = '#8a6';
    cx.fillRect(0, -1, 10, 2);
    cx.fillStyle = '#bbb';
    cx.fillRect(9, -4, 4, 8);
    cx.restore();
  }
  if (G.crew.ex) {
    const x = Math.min(W - 40, B.x + B.w + 34);
    const a = Math.sin(T * 3) * 0.35;
    cx.fillStyle = '#222';
    rr(x - 26, gy - 8, 52, 10, 5);
    cx.fill();
    cx.fillStyle = '#ffd84d';
    cx.fillRect(x - 20, gy - 26, 32, 18);
    cx.fillStyle = '#9fd6ff';
    cx.fillRect(x - 2, gy - 23, 11, 10);
    cx.save();
    cx.translate(x - 18, gy - 22);
    cx.rotate(-2.2 + a);
    cx.fillStyle = '#f0b400';
    cx.fillRect(0, -3, 34, 6);
    cx.translate(34, 0);
    cx.rotate(1.2 + a);
    cx.fillRect(0, -3, 24, 6);
    cx.fillStyle = '#555';
    cx.fillRect(20, -6, 10, 12);
    cx.restore();
  }
  if (G.crew.cr) {
    const cxp = Math.max(14, B.x - 70);
    const top = GROUND - H * 0.55;
    cx.strokeStyle = '#ff8f5a';
    cx.lineWidth = 4;
    cx.beginPath();
    cx.moveTo(cxp, GROUND);
    cx.lineTo(cxp, top);
    cx.lineTo(B.x + B.w * 0.3, top);
    cx.stroke();
    cx.lineWidth = 1;
    for (let yy = top; yy < GROUND; yy += 10) {
      cx.beginPath();
      cx.moveTo(cxp - 4, yy);
      cx.lineTo(cxp + 4, yy + 10);
      cx.stroke();
    }
    const ang = Math.sin(T * 2) * 0.5;
    const len = H * 0.3;
    const px = B.x + B.w * 0.15 + Math.sin(ang) * len;
    const py = top + Math.cos(ang) * len;
    cx.strokeStyle = '#bbb';
    cx.beginPath();
    cx.moveTo(B.x + B.w * 0.15, top);
    cx.lineTo(px, py);
    cx.stroke();
    cx.fillStyle = '#333';
    cx.beginPath();
    cx.arc(px, py, 11, 0, 7);
    cx.fill();
    cx.fillStyle = 'rgba(255,255,255,.2)';
    cx.beginPath();
    cx.arc(px - 3, py - 3, 4, 0, 7);
    cx.fill();
  }
  if (G.crew.dy && T % 2.2 < 0.25) {
    const ex = B.x + B.w * ((Math.floor(T / 2.2) * 37) % 10) / 10;
    const ey = GROUND - 10;
    const r = Math.max(3, ((T % 2.2) / 0.25) * 40);
    const g = cx.createRadialGradient(ex, ey, 2, ex, ey, r);
    g.addColorStop(0, '#fff6a0');
    g.addColorStop(0.5, '#ff8a3d');
    g.addColorStop(1, 'rgba(255,60,40,0)');
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(ex, ey, r, 0, 7);
    cx.fill();
  }
  if (G.crew.rb) {
    const x = Math.min(W - 22, B.x + B.w + 80);
    const bob = Math.sin(T * 4) * 2;
    cx.fillStyle = '#7fe3ff';
    rr(x - 12, gy - 36 + bob, 24, 22, 4);
    cx.fill();
    cx.fillStyle = '#1b1f3b';
    cx.fillRect(x - 8, gy - 30 + bob, 16, 6);
    cx.fillStyle = '#ff4757';
    cx.fillRect(x - 5, gy - 29 + bob, 3, 3);
    cx.fillRect(x + 2, gy - 29 + bob, 3, 3);
    cx.fillStyle = '#5aa9c9';
    cx.fillRect(x - 10, gy - 14, 6, 14);
    cx.fillRect(x + 4, gy - 14, 6, 14);
    cx.fillRect(x - 22, gy - 30 + bob, 10, 5);
  }
  if (G.crew.sat) {
    const bx = B.x + B.w / 2 + Math.sin(T * 1.3) * B.w * 0.3;
    const on = T % 3 < 1.2;
    cx.fillStyle = '#c9ced9';
    cx.fillRect(bx - 8, 6, 16, 10);
    cx.fillStyle = '#4c6fa8';
    cx.fillRect(bx - 26, 8, 16, 6);
    cx.fillRect(bx + 10, 8, 16, 6);
    if (on) {
      const g = cx.createLinearGradient(bx - 6, 0, bx + 6, 0);
      g.addColorStop(0, 'rgba(197,123,255,0)');
      g.addColorStop(0.5, 'rgba(240,200,255,.9)');
      g.addColorStop(1, 'rgba(197,123,255,0)');
      cx.fillStyle = g;
      cx.fillRect(bx - 7, 16, 14, B.y + B.h * 0.3 - 16);
      cx.fillStyle = 'rgba(240,200,255,.8)';
      cx.beginPath();
      cx.arc(bx, B.y + B.h * 0.3, 10 + Math.random() * 5, 0, 7);
      cx.fill();
    }
  }
}

/* ===================== 루프 ===================== */
let last = performance.now();
let saveT = 0;
let uiT = 0;

function loop(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  T += dt;

  // 자동 공격
  atkT -= dt;
  if (atkT <= 0) {
    atkT = fever > 0 ? 0.27 : 0.8;
    if (fall <= 0) hit('auto', 1, rnd(B.x + B.w * 0.2, B.x + B.w * 0.8), rnd(B.y + B.h * 0.3, B.y + B.h * 0.9));
  }

  // 용병
  const dps = totalDps();
  if (dps > 0 && fall <= 0) {
    crewT -= dt;
    if (crewT <= 0) {
      crewT = 0.25;
      crewAcc += dps * 0.25;
      hit('crew', dps * 0.25);
    }
    crewShowT -= dt;
    if (crewShowT <= 0 && crewAcc > 0) {
      crewShowT = 1;
      nums.push({ x: B.x + B.w * rnd(0.2, 0.8), y: B.y + B.h * rnd(0.5, 0.9), v: crewAcc, t: 0.9, crew: 1 });
      crewAcc = 0;
    }
  }

  if (fever > 0) {
    fever -= dt;
    if (fever <= 0) toast('피버 끝!');
  }
  if (combo > 0 && now - lastTap > 900) combo = 0;

  // 보스 타이머
  if (isBoss(G.stage) && fall <= 0) {
    bossT -= dt;
    if (bossT <= 0) {
      G.stage--;
      G.farm = true;
      G.hp = hpOf(G.stage);
      newCracks();
      bossT = BOSS_T;
      result('보스 실패', '#ff8a8a');
      toast('강해진 다음 위의 [보스 도전]을 누르세요');
      SFX.fail();
      save();
      ui();
    }
  }

  if (fall > 0) {
    fall -= dt;
    if (fall <= 0) {
      if (!G.farm) G.stage++;
      G.top = Math.max(G.top || 0, G.stage);
      G.hp = hpOf(G.stage);
      bossT = BOSS_T;
      newCracks();
      save();
      ui();
      if (isBoss(G.stage)) {
        toast(`⚠ 보스 건물! ${BOSS_T}초 안에 부숴라`);
        flash('rgba(255,60,80,.6)');
      }
    }
  }

  swing = Math.max(0, swing - dt * 5);
  shake = Math.max(0, shake - dt * 35);

  // 그리기
  cx.save();
  cx.translate(rnd(-shake, shake) * 0.6, rnd(-shake, shake) * 0.3);
  drawSky();

  const b = bOf(G.stage);
  const bw = Math.min(W * 0.9, W * b.w);
  const bh = GROUND * 0.68 * b.h + 20;
  const sink = fall > 0 ? Math.pow(1 - fall / 1.4, 2) * bh : 0;
  B = { x: (W - bw) / 2, y: GROUND - bh + sink, w: bw, h: bh };

  cx.save();
  cx.beginPath();
  cx.rect(0, 0, W, GROUND + 4);
  cx.clip();
  cx.translate(fall > 0 ? rnd(-4, 4) : 0, 0);
  drawBuilding(b, B.x, B.y, bw, bh, Math.max(0, G.hp / hpOf(G.stage)), isBoss(G.stage));
  cx.restore();

  for (const d of dust) {
    d.t -= dt;
    d.x += d.vx * dt;
    d.r += 30 * dt;
    cx.globalAlpha = Math.max(0, d.t / d.T) * 0.6;
    cx.fillStyle = '#9a8f9e';
    cx.beginPath();
    cx.arc(d.x, d.y - d.r * 0.4, d.r, 0, 7);
    cx.fill();
  }
  dust = dust.filter((d) => d.t > 0);
  cx.globalAlpha = 1;

  drawCrew();

  for (const im of impacts) {
    im.t -= dt;
    const a = im.t / 0.2;
    const radius = (im.crit ? 34 : 20) * (1.2 - a);
    cx.globalAlpha = a;
    cx.fillStyle = im.crit ? '#ffe14d' : '#fff';
    cx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * 6.28;
      const r2 = i % 2 ? radius * 0.4 : radius;
      cx.lineTo(im.x + Math.cos(ang) * r2, im.y + Math.sin(ang) * r2);
    }
    cx.fill();
  }
  impacts = impacts.filter((im) => im.t > 0);
  cx.globalAlpha = 1;

  for (const r of rings) {
    r.t -= dt;
    const a = 1 - r.t / r.T;
    cx.strokeStyle = tierCol(G.lv, T);
    cx.lineWidth = 3;
    cx.globalAlpha = 0.8 * (1 - ((a * 3) % 1));
    cx.beginPath();
    cx.arc(WX, WY - H * 0.12, 20 + ((a * 3) % 1) * 70, 0, 7);
    cx.stroke();
  }
  rings = rings.filter((r) => r.t > 0);
  cx.globalAlpha = 1;

  drawWeapon(WX, WY, G.lv, -0.35 - swing * 0.9);

  for (const p of parts) {
    p.vy += 600 * p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.t -= dt;
    cx.globalAlpha = Math.max(0, Math.min(1, p.t * 1.5));
    cx.fillStyle = p.c;
    if (p.smoke) {
      p.r += 8 * dt;
      cx.beginPath();
      cx.arc(p.x, p.y, p.r, 0, 7);
      cx.fill();
    } else {
      if (p.y > GROUND + 6 && p.vy > 0) {
        p.vy *= -0.3;
        p.vx *= 0.6;
      }
      cx.fillRect(p.x, p.y, p.r, p.r);
    }
  }
  if (parts.length > 500) parts.splice(0, parts.length - 500);
  parts = parts.filter((p) => p.t > 0);
  cx.globalAlpha = 1;

  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  for (const n of nums) {
    n.t -= dt;
    n.y -= dt * (n.crit ? 50 : 35);
    const a = Math.min(1, n.t * 2);
    cx.globalAlpha = a;
    const size = n.crit ? 30 : n.crew ? 15 : 20;
    cx.font = `400 ${size}px "Black Han Sans",sans-serif`;
    cx.lineWidth = 4;
    cx.strokeStyle = '#000';
    const text = (n.crit ? '치명! ' : '') + fmt(n.v);
    cx.strokeText(text, n.x, n.y);
    cx.fillStyle = n.crit ? '#ffe14d' : n.crew ? '#9fe8ff' : '#fff';
    cx.fillText(text, n.x, n.y);
  }
  nums = nums.filter((n) => n.t > 0);
  cx.globalAlpha = 1;
  cx.restore();

  // 상단 정보 (흔들림 없음)
  const ratio = fall > 0 ? 0 : Math.max(0, G.hp / hpOf(G.stage));
  const bx = W * 0.08;
  const by = 10;
  const bwid = W * 0.84;
  cx.fillStyle = 'rgba(0,0,0,.5)';
  rr(bx, by, bwid, 22, 11);
  cx.fill();
  const hg = cx.createLinearGradient(bx, 0, bx + bwid, 0);
  hg.addColorStop(0, isBoss(G.stage) ? '#ff3048' : '#ff7a59');
  hg.addColorStop(1, isBoss(G.stage) ? '#ff7a9a' : '#ffb35a');
  cx.fillStyle = hg;
  rr(bx, by, Math.max(0, bwid * ratio), 22, 11);
  cx.fill();
  cx.fillStyle = '#fff';
  cx.font = '800 12px "Gothic A1",sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillText(`${G.stage + 1}층 ${bName(G.stage)} · ${fmt(Math.max(0, G.hp))} / ${fmt(hpOf(G.stage))}`, W / 2, by + 11.5);
  cx.font = '800 12px "Gothic A1",sans-serif';
  cx.fillStyle = '#ffd84d';
  cx.fillText(`철거 보상 ${fmt(rewardOf(G.stage))}원${G.farm ? ' · 파밍 중' : ''}`, W / 2, by + 34);
  if (isBoss(G.stage) && fall <= 0) {
    cx.font = '400 26px "Black Han Sans",sans-serif';
    cx.fillStyle = bossT < 10 ? '#ff4757' : '#fff';
    cx.fillText(`보스 ${Math.ceil(bossT)}초`, W / 2, by + 60);
  }
  if (combo >= 3) {
    cx.font = `400 ${22 + Math.min(combo, 40) * 0.4}px "Black Han Sans",sans-serif`;
    cx.fillStyle = `hsl(${330 - combo * 3} 100% 65%)`;
    cx.textAlign = 'left';
    cx.fillText(`${combo} 콤보`, 12, by + 60);
    cx.fillStyle = 'rgba(255,255,255,.2)';
    cx.fillRect(12, by + 76, 90, 5);
    cx.fillStyle = '#ff5ec4';
    cx.fillRect(12, by + 76, 90 * Math.min(1, combo / 40), 5);
  }
  if (fever > 0) {
    cx.textAlign = 'right';
    cx.font = '400 22px "Black Han Sans",sans-serif';
    cx.fillStyle = '#ff5ec4';
    cx.fillText(`FEVER ${fever.toFixed(1)}`, W - 12, by + 60);
  }
  if (G.stage === 0 && G.lv === 0 && G.gold < 30) {
    cx.textAlign = 'center';
    cx.font = '800 14px "Gothic A1",sans-serif';
    cx.fillStyle = 'rgba(255,255,255,.8)';
    cx.fillText('건물을 연타해서 부숴보세요!', W / 2, B.y - 30);
  }

  saveT -= dt;
  if (saveT <= 0) {
    save();
    saveT = 5;
  }
  uiT -= dt;
  if (uiT <= 0) {
    ui();
    uiT = 0.2;
  }
  requestAnimationFrame(loop);
}

/* ===================== 방치 보상·출석 ===================== */
function welcome(): void {
  const secs = Math.min(8 * 3600, (Date.now() - G.last) / 1000);
  const dps = totalDps();
  const today = new Date().toDateString();
  const per = rewardOf(G.stage) / hpOf(G.stage);
  const offline = Math.floor(dps * secs * per * 0.5);
  const daily = G.daily !== today;
  if (offline < 1 && !daily) return;

  $('#wTitle').textContent = daily ? '오늘도 왔군요!' : '돌아왔군요!';
  $('#wMsg').textContent =
    offline > 0
      ? `자리 비운 ${Math.floor(secs / 3600)}시간 ${Math.floor((secs % 3600) / 60)}분 동안 용병들이 벌어온 돈`
      : '출석 보상';
  $('#wGold').textContent = offline > 0 ? `+${fmt(offline)} 원` : '';
  $('#wDaily').textContent = daily ? '출석 보상: 파괴 방지권 +1' : '';
  $('#wDouble').style.display = offline > 0 ? 'block' : 'none';

  const give = (multiplier: number) => {
    G.gold += offline * multiplier;
    if (daily) {
      G.daily = today;
      G.prot++;
    }
    $('#ovWelcome').classList.remove('show');
    save();
    ui();
    SFX.coin();
  };

  $('#wOk').onclick = () => give(1);
  $('#wDouble').onclick = () => {
    $('#ovWelcome').classList.remove('show');
    showAd(() => give(2));
  };
  $('#ovWelcome').classList.add('show');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) save();
  else welcome();
});

/* ===================== 랭킹 (기기 저장) ===================== */
let rankMode: 'floor' | 'lv' = 'floor';
let rankOpened = false;

function rankStatus(text: string): void {
  $('#rStatus').textContent = text;
}

function renderRank(): void {
  const record = loadRankRecord();
  const hasRecord = record.floor > 0 || record.lv > 0;

  $('#rBestFloor').textContent = record.floor ? `${record.floor}층` : '-';
  $('#rBestLv').textContent = record.lv ? `+${record.lv}` : '-';

  const list = $('#rList');
  list.textContent = '';

  // 1) 내 최고 기록
  const me = document.createElement('li');
  me.className = 'me';
  const meNo = document.createElement('span');
  meNo.className = 'no';
  meNo.textContent = '나';
  const meName = document.createElement('span');
  meName.className = 'nm';
  meName.textContent = record.nick || G.nick || '이름 없는 철거왕';
  const meSub = document.createElement('small');
  meSub.textContent = `최고 강화 +${record.lv} · 최고 ${record.floor || 0}층`;
  meName.appendChild(meSub);
  const meScore = document.createElement('span');
  meScore.className = 'sc';
  meScore.textContent = rankMode === 'floor' ? `${record.floor || 0}층` : `+${record.lv}`;
  me.append(meNo, meName, meScore);
  list.appendChild(me);

  // 2) 명예의 전당 (도전 과제)
  const head = document.createElement('li');
  head.className = 'hallHead';
  head.textContent = rankMode === 'floor' ? '명예의 전당 · 층수' : '명예의 전당 · 강화';
  list.appendChild(head);

  const targets = rankMode === 'floor' ? FLOOR_HALL : LV_HALL;
  targets.forEach((target) => {
    const achieved = rankMode === 'floor' ? record.floor >= target : record.lv >= target;
    const li = document.createElement('li');
    li.className = achieved ? 'done' : 'locked';

    const no = document.createElement('span');
    no.className = 'no';
    no.textContent = achieved ? '✓' : String(target);

    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = rankMode === 'floor' ? `${target}층 돌파` : `+${target} ${WNAME[Math.min(target, WNAME.length - 1)]}`;
    const sub = document.createElement('small');
    sub.textContent = achieved ? '명예의 전당 등록 완료' : '아직 미달성';
    name.appendChild(sub);

    const score = document.createElement('span');
    score.className = 'sc';
    if (achieved) {
      score.textContent = '달성';
    } else if (rankMode === 'floor') {
      score.textContent = `${Math.min(record.floor, target)}/${target}`;
    } else {
      score.textContent = `+${Math.min(record.lv, target)}/+${target}`;
    }

    li.append(no, name, score);
    list.appendChild(li);
  });

  if (!hasRecord) {
    rankStatus('아직 기록이 없어요. 건물을 부수고 무기를 강화해 보세요!');
  } else if (!record.nick && !G.nick) {
    rankStatus('기록은 이 기기에만 저장돼요 · 닉네임을 저장해 보세요');
  } else {
    rankStatus('기록은 이 기기에만 저장돼요 (localStorage)');
  }
}

function openRank(): void {
  rankOpened = true;
  const record = loadRankRecord();
  const nickInput = $('#nick') as HTMLInputElement;
  nickInput.value = G.nick || record.nick || '';
  $('#ovRank').classList.add('show');
  renderRank();
  if (!nickInput.value) nickInput.focus();
}

$('#btnRank').onclick = openRank;
$('#rClose').onclick = () => {
  rankOpened = false;
  $('#ovRank').classList.remove('show');
};

$('#nickSave').onclick = () => {
  const nick = cleanNick(($('#nick') as HTMLInputElement).value);
  if (!nick) {
    toast('닉네임을 입력하세요');
    return;
  }
  G.nick = saveNick(nick).nick;
  save();
  renderRank();
  toast('닉네임 저장 완료!');
};

document.querySelectorAll('#rTabs button').forEach((button) => {
  (button as HTMLElement).onclick = () => {
    rankMode = ((button as HTMLElement).dataset.m as 'floor' | 'lv') || 'floor';
    document.querySelectorAll('#rTabs button').forEach((x) => x.classList.toggle('on', x === button));
    renderRank();
  };
});

/* ===================== 시작 ===================== */
export function startGame(): void {
  // 앱 진입 시 보상형 광고를 미리 받아둬요. (토스 앱이 아니면 아무 일도 하지 않음)
  rewardedAd.preload();

  resize();
  ui();
  renderLists();
  syncRecord();
  welcome();
  requestAnimationFrame(loop);

  // 화면이 다시 보일 때 랭킹이 열려 있으면 최신 기록으로 갱신
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && rankOpened) renderRank();
  });
}
