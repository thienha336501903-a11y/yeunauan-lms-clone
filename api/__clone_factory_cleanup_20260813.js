import { supabase } from "../utils/supabase.js";
import { getGoogleDriveClient } from "../utils/lms.js";

const FILE_IDS = [
  "1KFXKFxDpo-UFsEPsXdKbctgSb9fgohDL","1Wvsv9TYByWd1fXh84WEVsNjQtXyArQVU","13OipmmqalPyL3bFhjEEn1iPQ3ztruhmz",
  "1710CjfQpq1bY0dyxPjBFIdHMHF6CjS3p","146T_jFyuZNWL7olNDTrsRJg5SOYmW_eE","1LmZBiSWtPbX5fP2_u3GB0KS8RkkAftZo","1iwKfeF2TUkMpUWAnyF41LP9FAeoR7Eqw","1ZQ0NWjfCpGqT5OZ0jjiZiHg17RiFwnqF",
  "1UBttQGHf4eq7WNH4FlH0PT9qNWq1EIF5","1nUomBXfKz9Moi-Gc4cfCId8kPRAxs4TX","1dM9_xg4vIQt99iTaAzJF4ru9jKO4L_R2","1op0GpmvS5E20tH9ntjM6jmZLOxXg0SHY",
  "1jEJrr_mkhVcWeFN0kqnxmNjcH7LVtN3C","1T9inxiHaFY22rrf8Z-JqLR6k4Fisd4-t",
  "1u8-olbnp35wj_pHy4UlLYQzp3U1CV9YB","1emur9Bvf-mlVwx6T-W1WQetkb5L38P9M","1YRBxWh28iBk7ZTT-4lwE3QKQtDEcvmLK","1cM1rijMiISWxB3DnZERR2lBe3pyLMpcs","1TQHHbYkuM9-GDfAJMn2lAxU4wJRm9Ihd","1VCfzOzFEokTdChtXPEbeKx6Ubtg94_yl","1DMbTBfoOQyWJvpog769ADC_8J-s5Fme9","1MSd4Z27dHz6H3Yn-NALQk6Yki_og8dZI","1s2xznQiHowyjQ-YHSCQ1LRxlYEIgxCrr","1CHe0MlvNkY4gf8sgM2DQpwqTngxQULlz","1B_0DvHnW5bxLgBslEa_WHzxo3ECXeMNU","1NdbCVmZwhOxdn9YwTH8ayzppx6cCdjR-","1eIDnVT1Fo6fJTnFsqFBY0reuZbmIpwr5","1bRP4crdRdwfFkoCxrKRjDp7VvGfPCQS3","1Ag4qkGLWwgZbTWOEbBojntyb5-Tckx-8","134XPUAMZFicnqsuuubA-eKZv9QHGIZfI","1dx5UmstmLqrL4C44UU2by5LufCvvaQvS","1x_zXT0EEhLHgfJ54HBydFcl7jLT8XkWg",
  "10_THKuEWlqIJP4PvXd1vrgjH_sd4rZoU","1933QzjyqKBgIyt1DtmC-e_m_J1msUUjy","1K3u_THZ4FwGwz4kalhkhXhPsVDNCERZp","1JYhcYSX4G2CXUOXpAAob2QlZZCtFtDvM","1Y9VtFy3eOwNakJtWjIFhEgp9uVw_3eoi","1ZXEM3ehpKjaQOCVt5mIuw-EQF23EHhe_","1CIPmoWx1e5bHlY8NCymagu_SoKWqUoVP","14cyhaF2Makq2DZKva5mA-d2k9RKn0qtO","1VWERSs_JmCD5fSxoS93rBrVFGhsNzIdX","1Lib_moLB7Qmyo2i0CHGd7poUJqQkkat3","1YPC7R25QWTR6wScKG3ZikQjuJj62e9jL"
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const { drive } = await getGoogleDriveClient(supabase);
    const deleted = [];
    const alreadyMissing = [];
    const errors = [];

    for (const fileId of FILE_IDS) {
      try {
        await drive.files.delete({ fileId, supportsAllDrives: true });
        deleted.push(fileId);
      } catch (err) {
        const code = Number(err?.code || err?.response?.status || 0);
        if (code === 404 || code === 410) alreadyMissing.push(fileId);
        else errors.push({ fileId, code, message: String(err?.message || err) });
      }
    }

    return res.status(errors.length ? 500 : 200).json({
      success: errors.length === 0,
      requested: FILE_IDS.length,
      deleted: deleted.length,
      alreadyMissing: alreadyMissing.length,
      errors
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err?.message || err) });
  }
}
