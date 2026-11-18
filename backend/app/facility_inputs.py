from datetime import time
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints, model_validator


class FacilityInput(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    address: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=250)]
    hourly_rate: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    opens_at: time | None = None
    closes_at: time | None = None

    @model_validator(mode="after")
    def paired_hours(self):
        if (self.opens_at is None) != (self.closes_at is None):
            raise ValueError("Set both opening and closing times, or leave both blank for 24 hours")
        if self.opens_at is not None and self.closes_at is not None:
            if self.opens_at.tzinfo or self.closes_at.tzinfo:
                raise ValueError("Use local times for opening and closing")
            if self.opens_at == self.closes_at:
                raise ValueError("Leave both fields blank for 24 hours")
        return self


class GridCell(BaseModel):
    grid_row: int = Field(ge=0, le=29)
    grid_column: int = Field(ge=0, le=39)


class SpotInput(GridCell):
    id: UUID | None = None
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)]


class LayoutInput(BaseModel):
    spots: list[SpotInput]
    buildings: list[GridCell] | None = None

    @model_validator(mode="after")
    def distinct_spots(self):
        if len({(spot.grid_row, spot.grid_column) for spot in self.spots}) != len(self.spots):
            raise ValueError("Only one spot can occupy a grid cell")
        if len({spot.label for spot in self.spots}) != len(self.spots):
            raise ValueError("Each spot needs a unique label")
        ids = [spot.id for spot in self.spots if spot.id is not None]
        if len(set(ids)) != len(ids):
            raise ValueError("A saved spot can appear only once")
        return self

    def validate_buildings(self, buildings: list[GridCell]):
        combined = [*self.spots, *buildings]
        if len({(cell.grid_row, cell.grid_column) for cell in combined}) != len(combined):
            raise ValueError("Parking spaces and buildings cannot share a cell")


class MaintenanceInput(BaseModel):
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def positive_duration(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("Maintenance must end after it starts")
        return self
