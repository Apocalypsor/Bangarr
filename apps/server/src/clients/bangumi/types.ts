export interface BangumiUser {
  id: number;
  username: string;
  nickname: string;
}

export interface BangumiSubject {
  id: number;
  name: string;
  name_cn: string;
  date?: string;
  type: number;
  platform?: string;
  aliases?: string[];
  eps?: number;
  infobox?: {
    key: string;
    value: unknown;
  }[];
}

export interface BangumiEpisode {
  id: number;
  subject_id: number;
  name: string;
  name_cn: string;
  sort: number;
  ep?: number;
  type: number;
  airdate?: string;
}

export interface BangumiRelation {
  id: number;
  relation: string;
  name: string;
  name_cn: string;
  type: number;
}

export interface BangumiPage<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface BangumiCollection {
  type: number;
  private: boolean;
  ep_status?: number;
}

export interface BangumiEpisodeCollection {
  type: number;
}
