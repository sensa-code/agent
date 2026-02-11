// ============================================================================
// VetEvidence — 獸醫安全規則常數
// ============================================================================

/** 貓的絕對禁用藥物 */
export const CAT_CONTRAINDICATED_DRUGS = [
  {
    drug: "Permethrin",
    reason: "對貓具有極高毒性，可導致震顫、癲癇、死亡。即使是含有 Permethrin 的犬用除蚤產品也不可用於貓。",
  },
  {
    drug: "Acetaminophen (Paracetamol / 普拿疼)",
    reason: "貓缺乏 glucuronidation 能力，無法代謝 Acetaminophen，導致 methemoglobinemia 和肝壞死，極低劑量即可致命。",
  },
  {
    drug: "高劑量 Aspirin",
    reason: "貓的 Aspirin 半衰期長達 38-72 小時（犬為 8 小時），常規犬用劑量在貓體內會蓄積中毒。僅可在獸醫監督下使用極低劑量。",
  },
];

/** MDR1 基因相關犬種警告 */
export const MDR1_WARNING = {
  breeds: [
    "Collie / 柯利犬",
    "Shetland Sheepdog / 喜樂蒂",
    "Australian Shepherd / 澳洲牧羊犬",
    "Old English Sheepdog / 古代牧羊犬",
    "Border Collie / 邊境牧羊犬",
    "German Shepherd / 德國牧羊犬（部分）",
    "Long-haired Whippet",
    "Silken Windhound",
  ],
  drugs: ["Ivermectin", "Milbemycin", "Moxidectin", "Loperamide", "Acepromazine"],
  description:
    "MDR1 (ABCB1) 基因突變導致 P-glycoprotein 功能缺失，使特定藥物無法被有效排出腦部，可能引起嚴重神經毒性（震顫、失明、昏迷、死亡）。",
};

/** 腎病動物用藥注意 */
export const CKD_DRUG_WARNINGS = {
  avoid: ["NSAIDs (Meloxicam, Carprofen, Deracoxib 等)"],
  adjustDose: ["Aminoglycosides", "ACE inhibitors", "排泄型抗生素"],
  description:
    "慢性腎病動物應避免使用 NSAIDs（加重腎損傷），並需調整經腎臟排泄藥物的劑量。",
};

/** 免責聲明 */
export const DISCLAIMER =
  "⚠️ AI 建議僅供專業獸醫師參考，不能取代臨床判斷。所有治療決策應結合臨床檢查、實驗室結果和患者個體狀況。";
