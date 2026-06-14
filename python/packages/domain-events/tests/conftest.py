"""Shared test fixtures: an in-memory SQLite engine bound to the test models."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import AppBase
from apso_domain_events.model import Base as EventsBase


@pytest.fixture()
def engine():
    eng = create_engine("sqlite://")
    AppBase.metadata.create_all(eng)
    EventsBase.metadata.create_all(eng)
    return eng


@pytest.fixture()
def Session(engine):
    return sessionmaker(bind=engine)
