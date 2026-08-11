export type CompanyEmployeeSeed = {
  id: string;
  name: string;
  department: string;
  position: string;
  jobTitle: string;
  type: string;
  joinDate: string;
  status: string;
  email: string;
  phone: string;
  address: string;
  manager: string;
  birth: string;
  history: { date: string; type: string; detail: string }[];
};

export type CompanyOrganizationSeed = {
  id: string;
  name: string;
  leaderEmployeeId: string | null;
  description: string;
};

type RawEmployee = [
  id: string,
  name: string,
  department: string,
  position: string,
  jobTitle: string,
  employmentType: string,
  joinDate: string,
  email: string,
  phone: string,
  birth: string,
  address: string,
];

const rawEmployees: RawEmployee[] = [
  ["ky.min", "KyungYoon Min", "구매팀", "매니저", "구매", "일반직4.5", "2025-09-15", "ruddbs9966@gmail.com", "010-2730-4713", "1996-08-23", "서울 노원구 동일로216길 47 (상계동, 상계주공5단지아파트)"],
  ["sjcho", "SuJong Cho", "소속 미지정", "대표이사", "미지정", "일반직4.5", "2023-09-20", "", "", "", ""],
  ["js.kong", "공지성", "온라인팀", "매니저", "마케팅", "일반직4.5", "2025-06-09", "kongdaniel8790@gmail.com", "010-5574-8790", "1999-05-07", "서울 중구 동호로10길 30 (신당동, 약수하이츠) 106-502"],
  ["gw.kim", "김건우", "AI사업팀", "매니저", "영업", "일반직4.5", "2026-07-31", "gud7175@gmail.com", "01058857175", "1995-07-10", "경기 수원시 장안구 수성로 415-11 (조원동)"],
  ["gc.kim", "김권찬", "지원팀", "매니저", "경영지원", "일반직", "2026-08-10", "amoledgc@gmail.com", "01058020037", "1991-08-12", "인천 남동구 운연천로 9 (서창동, 인천서창엘에이치14단지)"],
  ["dy.kim", "김덕유", "온라인팀", "매니저", "마케팅", "일반직4.5", "2026-07-06", "kimdyu1202@gmail.com", "01036903936", "1992-01-21", "서울 동대문구 천호대로31길 55 (용두동, 주연스위트빌 청량lll)"],
  ["ms1211", "김민성", "AI사업팀", "매니저", "영업", "일반직4.5", "2025-04-04", "kuangjo@naver.com", "010-4210-8865", "1995-12-11", "경기 남양주시 별내중앙로 10 (별내동) 102-3708"],
  ["sg.kim", "김상균", "AI사업팀", "매니저", "영업", "일반직", "2026-08-10", "kimksk789@gmail.com", "010-9972-9226", "1993-12-27", "서울 강남구 개포로110길 15 (일원동, 일원동우성7차아파트)"],
  ["yh.kim", "김영훈", "기술팀", "매니저", "기술지원", "일반직4.5", "2026-01-14", "hoon8464@gmail.com", "010-4785-8464", "1998-04-10", "서울 성동구 왕십리로31나길 22 (하왕십리동, 한신무학아파트)"],
  ["owwon", "김장원", "AI사업팀", "매니저", "영업", "일반직4.5", "2026-08-03", "jwjw7408@gmail.com", "01058020805", "2004-08-05", "서울 성동구 송정4가길 36 (송정동)"],
  ["juana11", "민아영", "온라인팀", "매니저", "마케팅", "일반직4.5", "2025-08-18", "dkfhrhry7@naver.com", "010-3580-7433", "1998-07-13", "경기 남양주시 경춘로 498 (다산동) 825호"],
  ["yj916938", "민철중", "기술팀", "매니저", "기술지원", "일반직4.5", "2025-09-22", "yj979788@gmail.com", "01094516761", "1998-10-18", "서울 서대문구 연희로12길 32 (연희동)"],
  ["pjs", "박정식", "구매팀", "매니저", "구매", "일반직4.5", "2026-07-31", "suitcase2825@gmail.com", "01054504336", "1987-11-22", "경기 수원시 권선구 효원로220번길 17 (권선동)"],
  ["jone", "신제원", "온라인팀", "매니저", "마케팅", "일반직4.5", "2024-11-14", "jone@xdnode.co.kr", "", "2025-07-25", ""],
  ["hj.shin", "신효진", "지원팀", "매니저", "경영지원", "일반직4.5", "2026-01-14", "gywls1325@gmail.com", "010-5283-7159", "2001-07-19", "서울 광진구 광나루로16길 9-7 (화양동)"],
  ["ks.yeom", "염경석", "AI사업팀", "매니저", "영업", "일반직4.5", "2026-01-14", "yks9546@gmail.com", "010-8993-9546", "1993-10-07", "서울 강동구 고덕로 333 (고덕동, 고덕그라시움)"],
  ["jy.oh", "오지영", "지원팀", "매니저", "영업지원", "일반직4.5", "2025-09-08", "wldudtod12@naver.com", "01029444138", "1996-10-02", "서울 동대문구 경동시장로10길 6 (제기동, 주함해븐빌)"],
  ["wbs417", "우보석", "AI사업팀", "매니저", "영업", "일반직4.5", "2026-07-06", "woobosuk417@gmail.com", "01052784170", "1990-04-17", "서울 중랑구 면목로95길 12-4 (상봉동)"],
  ["sy.lee", "이서윤", "구매팀", "매니저", "구매", "일반직4.5", "2026-07-31", "new961116@gmail.com", "01081161996", "1996-11-16", "경기 남양주시 식송2로 6-31 (별내동)"],
  ["sh.lee", "이세현", "AI사업팀", "매니저", "영업", "일반직4.5", "2025-04-16", "starland0414@naver.com", "010-9731-3370", "1994-04-14", "서울 마포구 상암산로1길 92 (상암동, 상암월드컵파크 7단지) 711동 1402호"],
  ["lhy0220", "이호영", "구매팀", "매니저", "구매", "일반직4.5", "2025-05-22", "lhy0220@naver.com", "010-3791-3687", "1990-02-20", "경기 하남시 미사강변한강로 295 (망월동) 447호"],
  ["ym.lim", "임영민", "AI사업팀", "책임매니저", "영업", "일반직4.5", "2024-01-15", "", "01062471202", "1990-08-26", ""],
  ["meeso97", "장미소", "지원팀", "매니저", "경영지원", "일반직4.5", "2025-03-17", "d4nr4n@gmail.com", "010-5127-8229", "1997-12-27", ""],
  ["softjcy", "장창영", "구매팀", "매니저", "구매", "일반직4.5", "2026-08-03", "softjcy@gmail.com", "01084881271", "1990-01-03", "서울 노원구 동일로208길 20 (중계동, 무지개아파트)"],
  ["ys.jung", "정윤수", "AI사업팀", "매니저", "영업", "일반직4.5", "2026-07-31", "dkfnfn9006@gmail.com", "010-6221-8357", "1997-10-18", "서울 강동구 풍성로37가길 31-9 (성내동, 뜨라네)"],
  ["chanhwi", "조찬휘(메일확인용)", "소속 미지정", "책임매니저", "미지정", "일반직4.5", "2023-02-06", "chanhwi@xdnode.co.kr", "", "", ""],
  ["kh.choi", "최건희", "기술팀", "매니저", "기술지원", "일반직4.5", "2026-07-31", "kunheex97@gmail.com", "010-6257-3156", "1997-05-07", "서울 동대문구 답십리로64길 31-2 (장안동)"],
  ["ys.hong", "홍윤서", "온라인팀", "매니저", "마케팅", "일반직4.5", "2026-04-06", "hys000904@gmail.com", "010-2733-5105", "2000-09-04", "경기 부천시 소사구 범안로 220 (옥길동, 옥길호반베르디움)"],
];

const display = (value: string) => value || "미입력";
const dotted = (value: string) => value.replaceAll("-", ".");

export const companyEmployees: CompanyEmployeeSeed[] = rawEmployees.map((employee) => {
  const [id, name, department, position, jobTitle, type, joinDate, email, phone, birth, address] = employee;
  const formattedJoinDate = dotted(joinDate);
  return {
    id,
    name,
    department,
    position,
    jobTitle,
    type,
    joinDate: formattedJoinDate,
    status: "재직",
    email: display(email),
    phone: display(phone),
    address: display(address),
    manager: "",
    birth: birth ? dotted(birth) : "미입력",
    history: [{ date: formattedJoinDate, type: "입사", detail: `${department} ${position} 입사` }],
  };
});

export const companyOrganizations: CompanyOrganizationSeed[] = [
  { id: "org-purchase", name: "구매팀", leaderEmployeeId: null, description: "구매 및 조달 업무" },
  { id: "org-online", name: "온라인팀", leaderEmployeeId: null, description: "온라인 채널 및 마케팅 업무" },
  { id: "org-ai-business", name: "AI사업팀", leaderEmployeeId: null, description: "AI 사업 영업 및 고객 관리" },
  { id: "org-support", name: "지원팀", leaderEmployeeId: null, description: "경영지원 및 영업지원 업무" },
  { id: "org-technology", name: "기술팀", leaderEmployeeId: null, description: "기술지원 업무" },
  { id: "org-unassigned", name: "소속 미지정", leaderEmployeeId: null, description: "원본 자료에 소속 조직이 입력되지 않은 인원" },
];

export const companyRanks = ["매니저", "책임매니저", "대표이사"];
export const companyJobTitles = ["구매", "마케팅", "영업", "경영지원", "기술지원", "영업지원", "미지정", "조직장"];
