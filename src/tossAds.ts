/**
 * 앱인토스 보상형 광고 연동
 *
 * - SDK: @apps-in-toss/web-framework 3.x (`loadFullScreenAd`, `showFullScreenAd`)
 * - 흐름: 앱 진입 시 미리 로드(load) → 보여줄 때 show → 닫히면(dismissed) 다음 광고를 다시 load
 * - 보상은 `userEarnedReward` 이벤트에서만 지급해요. `dismissed` 만으로는 지급하지 않아요.
 * - 토스 앱이 아닌 일반 브라우저에서는 `isSupported()` 가 false 라서 게임 쪽의 테스트 오버레이로 대체돼요.
 */
import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';

/**
 * 보상형 광고 그룹 ID
 *
 * - 기본값은 앱인토스 콘솔 > 인앱 광고(IAA)에서 발급받은 실제 보상형 광고 그룹 ID예요.
 * - 다른 ID로 빌드해야 할 때는 환경변수 `VITE_AIT_AD_GROUP_ID` 로 덮어쓸 수 있어요.
 *   (테스트용: `VITE_AIT_AD_GROUP_ID=ait-ad-test-rewarded-id`)
 */
export const AD_GROUP_ID: string =
  ((import.meta.env?.VITE_AIT_AD_GROUP_ID as string | undefined) ?? '').trim() ||
  'ait.v2.live.a3b6ece2fba24488';

/** 광고 시도 결과 */
export type AdOutcome = 'rewarded' | 'dismissed' | 'failed' | 'unsupported';

/** 광고를 미리 받아오는 데 기다려 줄 시간 */
const LOAD_TIMEOUT_MS = 6000;

type AdState = 'idle' | 'loading' | 'ready' | 'showing';

class RewardedAdManager {
  private state: AdState = 'idle';
  private supported: boolean | null = null;
  private unregisterLoad: (() => void) | null = null;
  private readyWaiters = new Set<(ready: boolean) => void>();

  /** 이 환경에서 보상형 전면 광고를 쓸 수 있는지 (토스 앱 5.227.0 이상) */
  isSupported(): boolean {
    if (this.supported !== null) return this.supported;
    try {
      const canLoad =
        typeof loadFullScreenAd.isSupported === 'function' && loadFullScreenAd.isSupported();
      const canShow =
        typeof showFullScreenAd.isSupported === 'function' && showFullScreenAd.isSupported();
      this.supported = Boolean(canLoad && canShow);
    } catch (error) {
      console.warn('[ads] 지원 여부를 확인하지 못했어요.', error);
      this.supported = false;
    }
    return this.supported;
  }

  /** 광고가 이미 로드되어 바로 띄울 수 있는 상태인지 */
  isReady(): boolean {
    return this.state === 'ready';
  }

  /** 앱 진입 시 한 번 호출: 다음에 바로 띄울 수 있게 미리 받아둬요. */
  preload(): void {
    if (!this.isSupported()) return;
    if (this.state === 'loading' || this.state === 'ready' || this.state === 'showing') return;

    this.state = 'loading';
    try {
      this.unregisterLoad?.();
      this.unregisterLoad = loadFullScreenAd({
        options: { adGroupId: AD_GROUP_ID },
        onEvent: (event) => {
          if (event.type === 'loaded') {
            this.state = 'ready';
            this.flushReady(true);
          }
        },
        onError: (error) => {
          console.warn('[ads] 광고를 불러오지 못했어요.', error);
          this.state = 'idle';
          this.flushReady(false);
        },
      });
    } catch (error) {
      console.warn('[ads] 광고를 불러오지 못했어요.', error);
      this.state = 'idle';
      this.flushReady(false);
    }
  }

  /**
   * 보상형 광고를 띄우고, 결과를 돌려줘요.
   * - 'rewarded'    : 끝까지 보고 보상을 받음 → 보상 지급
   * - 'dismissed'   : 보상 없이 닫힘 → 보상 지급 안 함
   * - 'failed'      : 로드/표시 실패
   * - 'unsupported' : 토스 앱이 아니라서 SDK를 쓸 수 없음 → 호출한 쪽에서 대체 UI 처리
   */
  async show(): Promise<AdOutcome> {
    if (!this.isSupported()) return 'unsupported';
    if (this.state === 'showing') return 'failed';

    if (this.state !== 'ready') {
      const ready = await this.waitUntilReady(LOAD_TIMEOUT_MS);
      if (!ready) {
        // 다음 시도를 위해 다시 한 번 로드만 걸어둬요.
        this.state = 'idle';
        this.preload();
        return 'failed';
      }
    }

    return this.present();
  }

  private present(): Promise<AdOutcome> {
    return new Promise<AdOutcome>((resolve) => {
      let settled = false;
      let earned = false;

      const finish = (outcome: AdOutcome) => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };

      // 광고가 닫히면 다음 광고를 미리 받아둬요. (load → show → load → show)
      const prepareNext = () => {
        this.state = 'idle';
        this.preload();
      };

      this.state = 'showing';
      try {
        showFullScreenAd({
          options: { adGroupId: AD_GROUP_ID },
          onEvent: (event) => {
            switch (event.type) {
              case 'userEarnedReward':
                // ✅ 보상은 이 이벤트에서만 지급
                earned = true;
                finish('rewarded');
                break;
              case 'dismissed':
                // ❌ dismissed 만으로는 보상 지급하지 않음
                finish(earned ? 'rewarded' : 'dismissed');
                prepareNext();
                break;
              case 'failedToShow':
                finish('failed');
                prepareNext();
                break;
              default:
                break;
            }
          },
          onError: (error) => {
            console.warn('[ads] 광고를 띄우지 못했어요.', error);
            finish('failed');
            prepareNext();
          },
        });
      } catch (error) {
        console.warn('[ads] 광고를 띄우지 못했어요.', error);
        finish('failed');
        prepareNext();
      }
    });
  }

  private waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.state === 'ready') return Promise.resolve(true);
    if (!this.isSupported()) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      let done = false;
      const settle = (ready: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.readyWaiters.delete(settle);
        resolve(ready);
      };
      const timer = setTimeout(() => settle(false), timeoutMs);
      this.readyWaiters.add(settle);
      this.preload();
    });
  }

  private flushReady(ready: boolean) {
    const waiters = Array.from(this.readyWaiters);
    this.readyWaiters.clear();
    waiters.forEach((settle) => settle(ready));
  }
}

/** 앱 전체에서 하나만 쓰는 보상형 광고 매니저 */
export const rewardedAd = new RewardedAdManager();
