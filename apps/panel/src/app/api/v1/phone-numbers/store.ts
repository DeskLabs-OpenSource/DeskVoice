import { ApiError } from "../../../../server/context";

/** Número repetido na organização é erro de quem digitou, não conflito de servidor. */
export async function refusingDuplicates<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new ApiError(400, "number_already_registered", "This number is already registered.");
    }
    throw error;
  }
}
