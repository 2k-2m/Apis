from typing import Union

from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def read_root():
    return {'data': {'name': 'Kaleb'}}

@app.get("/About")
def about():
    return {'data':'about page'}
