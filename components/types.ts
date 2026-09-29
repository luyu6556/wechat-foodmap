export type Member = { id: string; name: string; color: string };

export type PlaceSummary = {
  id: string;
  name: string;
  address: string;
  category: "美食" | "玩乐";
  lat: number;
  lng: number;
  sourcePlatform: string;
  createdAt: number;
  creatorName: string;
  creatorColor: string;
  likesCount: number;
  visitsCount: number;
  averageRating: number | null;
  ratingsCount: number;
  coverPhotoId: string | null;
};

export type PlaceDetailData = {
  place: PlaceSummary & { sourceText: string; sourceUrl: string | null };
  comments: { id: string; body: string; createdAt: number; memberName: string; memberColor: string }[];
  photos: { id: string; createdAt: number; memberName: string; memberColor: string }[];
  visitors: Member[];
  my: { liked: number; visited: number; rating: number | null } | null;
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
