// ============================================================================
// VetEvidence — 獸醫安全規則常數（已壓縮）
// ============================================================================

/** 貓的絕對禁用藥物 */
export const CAT_CONTRAINDICATED_DRUGS = [
  {
    drug: "Permethrin",
    reason: "貓極高毒性（震顫→癲癇→死亡），犬用除蚤產品亦禁",
  },
  {
    drug: "Acetaminophen",
    reason: "貓缺乏 glucuronidation，致 methemoglobinemia/肝壞死，微量致命",
  },
  {
    drug: "高劑量 Aspirin",
    reason: "貓半衰期 38-72h（犬 8h），犬用劑量蓄積中毒，僅極低劑量監督使用",
  },
];

/** MDR1 基因相關犬種警告 */
export const MDR1_WARNING = {
  breeds: [
    "Collie(柯利)",
    "Sheltie(喜樂蒂)",
    "Aussie(澳牧)",
    "OES(古牧)",
    "Border Collie(邊牧)",
    "GSD(德牧,部分)",
    "Long-haired Whippet",
    "Silken Windhound",
  ],
  drugs: ["Ivermectin", "Milbemycin", "Moxidectin", "Loperamide", "Acepromazine"],
  description:
    "MDR1(ABCB1)突變致 P-gp 功能缺失，特定藥物無法排出腦部，引起神經毒性（震顫、失明、昏迷、死亡）。",
};

/** 腎病動物用藥注意 */
export const CKD_DRUG_WARNINGS = {
  avoid: ["NSAIDs (Meloxicam, Carprofen, Deracoxib 等)"],
  adjustDose: ["Aminoglycosides", "ACE inhibitors", "排泄型抗生素"],
  description:
    "CKD 動物避免 NSAIDs（加重腎損傷），需調整經腎排泄藥物劑量。",
};

/** 免責聲明 */
export const DISCLAIMER =
  "AI 建議僅供專業獸醫師參考，不能取代臨床判斷。";
