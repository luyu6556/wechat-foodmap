export type Member = { id: string; name: string; color: string; isOwner?: number; wechatLinked?: number };

export type PlaceSummary = {
  id: string;
  name: string;
  address: string;
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

export type LocatedPlace = {
  lat: number | null;
  lng: number | null;
  source: "poi" | "address" | "none";
  confidence: number;
  matchedName: string;
  message: string;
};
