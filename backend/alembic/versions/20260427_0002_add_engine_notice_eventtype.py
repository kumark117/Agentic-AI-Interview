"""add engine_notice to eventtype enum

Revision ID: 20260427_0002
Revises: 20260425_0001
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "20260427_0002"
down_revision = "20260425_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(sa.text("ALTER TYPE eventtype ADD VALUE 'engine_notice'"))


def downgrade() -> None:
    pass
