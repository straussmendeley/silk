package org.silkframework.dataset

import org.silkframework.config.Prefixes
import org.silkframework.entity.{BackwardOperator, ForwardOperator, Path, PathOperator}

/**
  * A data source that can give information about how given paths cover the sources input paths.
  */
trait CoverageDataSource {
  this: DataSource =>
  def pathCoverage(pathInputs: Seq[CoveragePathInput])(implicit prefixes: Prefixes): PathCoverageResult = {
    // This should get all paths defined for this source, depending on the implementation of the data source the depth might be limited to 1.
    val allPaths = retrievePaths("")
    val pathCoverages = for (sourcePath <- allPaths) yield {
      var covered = false
      var fullyCovered = false
      for (pathInput <- pathInputs;
           inputPath <- pathInput.paths) {
        if(matchPath(pathInput.typeUri, inputPath, sourcePath)) {
          covered = true
          if(fullCoveragePath(inputPath)) {
            fullyCovered = true
          }
        }
      }
      PathCoverage(sourcePath.serializeSimplified, covered, fullyCovered)
    }
    PathCoverageResult(pathCoverages)
  }

  /** Only paths that only have forward paths are considered to fully cover the input values. This assumption is true for
    * all nested types like XML and JSON, it may not be true for other data models. */
  def fullCoveragePath(path: Path): Boolean = {
    path.operators.forall {
      case _: ForwardOperator =>
        true
      case _ =>
        false // Operators like filters are expected to not fully cover a specific path.
    }
  }

  /** Returns true if the given input path matches the source path else false. */
  def matchPath(typeUri: String, inputPath: Path, sourcePath: Path): Boolean

  /** Normalized the input path, gets rid of filters, resolves backward paths. The backward path resolution only works for
    * nested data models. This won't work for example with graph data models like RDF where there is no unique parent.*/
  def normalizeInputPath(pathOperators: Seq[PathOperator]): Option[Seq[PathOperator]] = {
    // Should only include forward operators like the source path
    var cleanOperators = List.empty[PathOperator]
    for(op <- pathOperators) {
      op match {
        case f: ForwardOperator =>
          cleanOperators ::= f
        case b: BackwardOperator =>
          if(cleanOperators.isEmpty) {
            return None // Invalid path, short cir
          } else {
            cleanOperators = cleanOperators.tail
          }
        case _ =>
        // Throw away other operators
      }
    }
    Some(cleanOperators.reverse)
  }
}

case class PathCoverageResult(paths: Seq[PathCoverage])

case class PathCoverage(path: String, covered: Boolean, fully: Boolean)

case class CoveragePathInput(typeUri: String, paths: Seq[Path])