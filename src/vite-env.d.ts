/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 앱인토스 콘솔에서 발급받은 보상형 광고 그룹 ID (없으면 테스트 ID 사용) */
  readonly VITE_AIT_AD_GROUP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
