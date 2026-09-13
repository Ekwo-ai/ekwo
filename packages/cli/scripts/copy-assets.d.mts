/** Types for the build script, so the test that pins the package can import it. */
export declare const ASSET_FOLDERS: string[];
/** Copies supabase/{migrations,seed} and modules/ into `destination`; returns the relative paths written. */
export declare function copyAssets(destination: string): Promise<string[]>;
