export class BillError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
