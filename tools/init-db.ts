import "dotenv/config";
import { createAllIndexes } from "../lib/indexes";

(async () => {
  try {
    await createAllIndexes();
    console.log("Indexes ready.");
    process.exit(0);
  } catch (e:any) {
    console.error(e);
    process.exit(1);
  }
})();
