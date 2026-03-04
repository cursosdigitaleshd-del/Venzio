"""add_subscription_fields_to_user

Revision ID: add_subs_fields
Revises:
Create Date: 2026-03-03 20:54:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_subs_fields'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to users table
    op.add_column('users', sa.Column('minutes_used', sa.Float(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('subscription_start_date', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('status', sa.String(), nullable=False, server_default='inactive'))


def downgrade() -> None:
    # Remove the columns
    op.drop_column('users', 'status')
    op.drop_column('users', 'subscription_start_date')
    op.drop_column('users', 'minutes_used')