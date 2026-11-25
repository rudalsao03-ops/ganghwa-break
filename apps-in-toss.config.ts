/**
 * 앱인토스 미니앱 설정 파일
 *
 * - `ait build` 가 이 파일을 읽어 `ganghwa-break.ait` 번들을 만들어요.
 * - `appName` 은 앱인토스 콘솔에 등록한 미니앱 이름(appName, kebab-case)과 같아야 해요.
 *   콘솔에서 다른 이름을 발급받았다면 이 값만 바꾸면 돼요.
 */
export default {
  appName: 'ganghwa-break',
  // 로딩 화면(스플래시) 배경으로 쓰이는 대표 색상이에요. (brand는 deprecated, primaryColor만 사용)
  brand: {
    primaryColor: '#0f1226',
  },
  webView: {},
  permissions: [],
  webBundleDir: 'dist',
};
