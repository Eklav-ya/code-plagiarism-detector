import { db } from "./firebase";
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  deleteDoc,
  doc,
} from "firebase/firestore";

const COLLECTION = "history";
const MAX_HISTORY = 10;

// SAVE
import { serverTimestamp } from "firebase/firestore";

export async function saveHistory(userId, data) {
  if (!userId) return;

  try {
    await addDoc(collection(db, COLLECTION), {
      userId,

      // ---- Detailed fields (from #2) ----
      nameA: data.nameA,
      nameB: data.nameB,
      similarity_percent: data.similarity_percent,
      logic_similarity: data.logic_similarity,
      structure_similarity: data.structure_similarity,
      token_overlap: data.token_overlap,
      human_score: data.human_score,
      ai_generated_likelihood: data.ai_generated_likelihood ?? null,
      language_a: data.language_a,
      language_b: data.language_b,
      summary: data.summary,
      findings: data.findings,
      ai_reason: data.ai_reason ?? "",
      algo_token_similarity: data.algo_token_similarity ?? null,
      algo_structural_score: data.algo_structural_score ?? null,
      algo_normalized_overlap: data.algo_normalized_overlap ?? null,
      ai_run_count: data.ai_run_count ?? 0,
      ai_fallback: data.ai_fallback ?? false,
      matchingLines: data.matchingLines ?? [],
      timestamp: data.timestamp,


      // ✅ FIX: proper timestamp
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to save history:", err);
  }
}

// LOAD (latest 10)
export async function loadHistory(userId) {
  if (!userId) return [];

  try {
    const q = query(
  collection(db, COLLECTION),
  where("userId", "==", userId)
);

    const snapshot = await getDocs(q);

    return snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  } catch (err) {
    console.error("Failed to load history:", err);
    return [];
  }
}

// CLEAR
export async function clearHistory(userId) {
  if (!userId) return;

  try {
    const q = query(
      collection(db, COLLECTION),
      where("userId", "==", userId)
    );

    const snapshot = await getDocs(q);

    const deletions = snapshot.docs.map((d) =>
      deleteDoc(doc(db, COLLECTION, d.id))
    );

    await Promise.all(deletions);
  } catch (err) {
    console.error("Failed to clear history:", err);
  }
}