export interface BangumiDataItem {
  title: string;
  type?: string;
  titleTranslate?: Record<string, string[]>;
  begin?: string;
  sites?: {
    site: string;
    id: string;
  }[];
}
