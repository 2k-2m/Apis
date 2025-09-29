from fastapi import FastAPI
from typing import Optional
from pydantic import BaseModel
app = FastAPI()


@app.get("/")
def read_root():
    return {'data': 'blog list'}

@app.get("/blog")
def show(limit = 10, published:bool = True, sort: Optional[str] = None):
    if published: 
        return {'data': f'{limit} pubished blogs from the db'}
    else: 
        return {'data': f'{limit} blogs from the db'}

@app.get("/blog/unpublished")
def unpublished():
    return {'data': 'all the unpublished blogs'}

@app.get("/blog/{id}")
def show(id:int):
    return {'data': id}


@app.get("/blog/{id}/comments")
def comments(id):
    return {'data': {'comment 1', 'comment 2'}}



class Blog(BaseModel):
    tittle: str
    body: str
    published: Optional[bool]

@app.post("/blog")
def createblog(request: Blog):
    return {'data': f"Blog is created with tittle as {request.tittle}"}