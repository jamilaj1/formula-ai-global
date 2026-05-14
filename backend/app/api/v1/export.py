"""Export a formula as PDF / Excel / MSDS."""
import io

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse


router = APIRouter(prefix="/export", tags=["export"])


@router.get("/{formula_id}/pdf")
async def export_pdf(formula_id: str, request: Request):
    supabase = request.app.state.supabase
    res = supabase.table("formulas").select("*").eq("id", formula_id).single().execute()
    if not res.data:
        raise HTTPException(404)

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
    except ImportError:
        raise HTTPException(500, "reportlab not installed")

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, 800, res.data.get("name") or "Formula")
    c.setFont("Helvetica", 10)
    y = 770
    for comp in res.data.get("components", []):
        line = f"{comp.get('name_en','')}  {comp.get('percentage','')}  CAS {comp.get('cas_number','-')}"
        c.drawString(50, y, line)
        y -= 14
        if y < 60:
            c.showPage(); y = 800
    c.save()
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{formula_id}.pdf"'},
    )


@router.get("/{formula_id}/xlsx")
async def export_xlsx(formula_id: str, request: Request):
    supabase = request.app.state.supabase
    res = supabase.table("formulas").select("*").eq("id", formula_id).single().execute()
    if not res.data:
        raise HTTPException(404)

    try:
        import xlsxwriter
    except ImportError:
        raise HTTPException(500, "xlsxwriter not installed")

    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    ws = wb.add_worksheet("Formula")
    ws.write_row(0, 0, ["Component", "Percentage", "CAS", "Function"])
    for i, comp in enumerate(res.data.get("components", []), start=1):
        ws.write_row(
            i,
            0,
            [
                comp.get("name_en", ""),
                comp.get("percentage", ""),
                comp.get("cas_number", ""),
                comp.get("function", ""),
            ],
        )
    wb.close()
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{formula_id}.xlsx"'},
    )
