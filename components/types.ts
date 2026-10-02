export type Member = { id: string; name: string; color: string; isOwner?: number; wechatLinked?: number };

export type PlaceSummary = {
  id: string;
  name: string;
  address: string;
  // 添加者自己写的推荐理由，选填；详情页有内容才显示那一段。
  recommendation: string;
  category: "美食" | "玩乐";
  lat: number;
  lng: number;
  sourcePlatform: string;
  // 以下三项是截图识别的第三方平台数据，截图里没有时为空 —— 与群友自己的评分是两回事。
  cuisine: string;
  platformRating: number | null;
  ratingCount: number | null;
  avgPrice: number | null;
  createdAt: number;
  creatorName: string;
  creatorColor: string;
  creatorId: string;
  likesCount: number;
  visitsCount: number;
  averageRating: number | null;
  ratingsCount: number;
  coverPhotoId: string | null;
};

export type PlaceDetailData = {
  place: PlaceSummary & { sourceText: string; sourceUrl: string | null; sourceRaw: string };
  comments: { id: string; body: string; createdAt: number; memberName: string; memberColor: string; canManage: boolean }[];
  photos: { id: string; createdAt: number; memberName: string; memberColor: string; canManage: boolean }[];
  visitors: Member[];
  my: { liked: number; visited: number; rating: number | null } | null;
  canManagePlace: boolean;
};

export type ResolvedPlace = {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  sourceUrl: string | null;
  sourcePlatform: string;
  message: string;
};

// 截图识别的结果。lat/lng 不在这里 —— 截图里没有坐标，定位要另外问 /api/geocode。
export type RecognizedPlace = {
  name: string;
  cuisine: string;
  platformRating: number | null;
  ratingCount: number | null;
  avgPrice: number | null;
  address: string;
  city: string;
  district: string;
  rawText: string;
  message: string;
};

export type PlaceCandidate = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  exactBranch: boolean;
};

export type LocatedPlace = {
  lat: number | null;
  lng: number | null;
  source: "poi" | "address" | "none";
  confidence: number;
  matchedName: string;
  message: string;
  // 有歧义时服务端把命中的候选交回来，由用户挑正确的一家；没歧义时是空数组。
  candidates: PlaceCandidate[];
};

export type PollMember = { id: string; name: string; color: string };
export type PollVote = {
  placeId: string;
  memberId: string;
  memberName: string;
  memberColor: string;
  note: string;
  createdAt: number;
  mine: boolean;
};
export type PollOption = {
  placeId: string;
  name: string;
  address: string;
  cuisine: string;
  avgPrice: number | null;
  platformRating: number | null;
  averageRating: number | null;
  deleted: boolean;
  count: number;
  votes: PollVote[];
};
export type PollSummary = {
  id: string;
  title: string;
  status: "open" | "closed";
  createdAt: number;
  closedAt: number | null;
  closedByName: string | null;
  creatorName: string;
  creatorColor: string;
  totalVotes: number;
  optionCount: number;
  totalMembers: number;
  topOptions: { placeId: string; name: string; count: number }[];
};
export type PollDetail = {
  poll: {
    id: string;
    title: string;
    status: "open" | "closed";
    createdAt: number;
    createdBy: string;
    creatorName: string;
    creatorColor: string;
    closedAt: number | null;
    closedBy: string | null;
    closedByName: string | null;
  };
  options: PollOption[];
  my: { placeId: string; note: string } | null;
  totalMembers: number;
  notVoted: PollMember[];
};
export type PollList = {
  open: PollSummary | null;
  history: PollSummary[];
  nextCursor: string | null;
};
export type PollCandidate = {
  id: string;
  name: string;
  address: string;
  cuisine: string;
  avgPrice: number | null;
  platformRating: number | null;
  averageRating: number | null;
};
