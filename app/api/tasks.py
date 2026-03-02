"""Tasks API: list, create, update for Dashboard persistence (Supabase)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.task_service import create_task, list_tasks, update_task

router = APIRouter(prefix="/tasks", tags=["tasks"])


class CreateTaskBody(BaseModel):
    user_id: str
    status: str | None = None
    payload: dict | None = None


class UpdateTaskBody(BaseModel):
    status: str | None = None
    payload: dict | None = None


@router.get("")
def get_tasks(user_id: str = Query(..., description="User ID (e.g. from auth)")) -> dict:
    """List all tasks for the user. Returns { tasks: [...] }."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        rows = list_tasks(user_id)
        return {"tasks": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("")
def post_task(body: CreateTaskBody) -> dict:
    """Create a task. Body: { user_id, status?, payload? }. payload should include type: 'generic' | 'call' and task fields."""
    if not body.user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    payload = body.payload if body.payload is not None else {}
    status_val = body.status if body.status is not None else "ready_to_queue"
    try:
        row = create_task(body.user_id, payload, status=status_val)
        return row
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.patch("/{task_id}")
def patch_task(
    task_id: str,
    body: UpdateTaskBody,
    user_id: str = Query(..., description="User ID"),
) -> dict:
    """Update a task. Body: { status?, payload? }. Only provided fields are updated."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        row = update_task(task_id, user_id, status=body.status, payload=body.payload)
        if row is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return row
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
