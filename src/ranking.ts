/**
 * 로컬 랭킹(기기 저장) — 원본의 클로드 아티팩트 전용 DB 랭킹을 대체해요.
 *
 * - 서버가 없는 미니앱이므로 내 최고 기록을 localStorage 에 저장해요.
 * - 기록 화면에는 내 최고 기록 + 명예의 전당(도전 과제)이 함께 보여요.
 */

export const RANK_STORAGE_KEY = 'gw_rank_v1';
export const NICK_MAX = 10;

/** 내 최고 기록 */
export interface RankRecord {
  nick: string;
  /** 최고 층수 (1층부터) */
  floor: number;
  /** 최고 강화 단계 */
  lv: number;
  updatedAt: number;
}

/** 최고 층수 명예의 전당 (도달하면 달성) */
export const FLOOR_HALL: number[] = [10, 25, 50, 100];

/** 최고 강화 명예의 전당 (도달하면 달성) */
export const LV_HALL: number[] = [5, 10, 15, 20, 26];

const EMPTY_RECORD: RankRecord = { nick: '', floor: 0, lv: 0, updatedAt: 0 };

export function cleanNick(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICK_MAX);
}

export function loadRankRecord(): RankRecord {
  try {
    const raw = localStorage.getItem(RANK_STORAGE_KEY);
    if (!raw) return { ...EMPTY_RECORD };
    const parsed = JSON.parse(raw) as Partial<RankRecord>;
    return {
      nick: cleanNick(parsed.nick ?? ''),
      floor: Math.max(0, Number(parsed.floor) || 0),
      lv: Math.max(0, Number(parsed.lv) || 0),
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch (error) {
    console.warn('[rank] 저장된 기록을 읽지 못했어요.', error);
    return { ...EMPTY_RECORD };
  }
}

export function saveRankRecord(record: RankRecord): RankRecord {
  const next: RankRecord = {
    nick: cleanNick(record.nick),
    floor: Math.max(0, Math.floor(record.floor) || 0),
    lv: Math.max(0, Math.floor(record.lv) || 0),
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(RANK_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('[rank] 기록을 저장하지 못했어요.', error);
  }
  return next;
}

/** 닉네임만 바꿔서 저장해요. */
export function saveNick(nick: string): RankRecord {
  const current = loadRankRecord();
  return saveRankRecord({ ...current, nick: cleanNick(nick) });
}

/**
 * 게임 진행 상황으로 최고 기록을 갱신해요. (갱신된 경우에만 저장)
 * @param nick 닉네임
 * @param floor 현재 도달한 최고 층수 (1층부터)
 * @param lv 최고 강화 단계
 */
export function syncRankRecord(nick: string, floor: number, lv: number): RankRecord {
  const current = loadRankRecord();
  const nextFloor = Math.max(current.floor, Math.floor(floor) || 0);
  const nextLv = Math.max(current.lv, Math.floor(lv) || 0);
  const nextNick = cleanNick(nick) || current.nick;

  if (nextFloor === current.floor && nextLv === current.lv && nextNick === current.nick) {
    return current;
  }
  return saveRankRecord({ nick: nextNick, floor: nextFloor, lv: nextLv, updatedAt: Date.now() });
}
