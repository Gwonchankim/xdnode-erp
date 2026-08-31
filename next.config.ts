import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // vinext 는 multipart/form-data POST 를 전부 서버 액션 후보로 보고 이 상한을 먼저 적용한다
      // (node_modules/vinext/dist/server/app-server-action-execution.js 의
      //  isProgressiveServerActionRequest). 그래서 파일 업로드도 여기에 걸린다.
      // 기본값 1MB 로는 1MB 넘는 PDF 가 라우트에 닿지도 못하고 본문 없는 413 만 돌아왔다.
      // app/api/documents/route.ts 의 자체 검사와 같은 25MB 로 맞춘다.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
