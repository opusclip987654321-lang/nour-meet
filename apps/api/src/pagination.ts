import { z } from "zod";

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export type Pagination = z.infer<typeof paginationQuery>;

export const toSkipTake = ({ page, pageSize }: Pagination) => ({ skip: (page - 1) * pageSize, take: pageSize });

export const paginated = <T>(items: T[], total: number, { page, pageSize }: Pagination) => ({
  items,
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize))
});
