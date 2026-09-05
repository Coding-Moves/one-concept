/** Root navigator params. The concept-detail modal sits above the tabs so it
 *  can be opened from any tab (History, Profile) — see App.tsx. */
export type RootStackParamList = {
  Tabs: undefined;
  ConceptDetail: {
    conceptId: string;
    /** Optional bits the opener already has, so the header paints instantly
     *  while the full body loads. */
    title?: string;
    topicName?: string;
    likeCount?: number;
  };
};
