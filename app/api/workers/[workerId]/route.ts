import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workerId: string }> },
) {
  try {
    const { supabase, user } = await requireUser();
    const { workerId } = await params;
    const { data, error } = await supabase
      .from("workers")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", workerId)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError("Active worker not found.", 404);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
